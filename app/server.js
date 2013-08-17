var express = require("express");
var moment = require("moment");
var async = require("async");
var mu = require("mu2");
var db = require("./db.js");
var wp = require("./waypoints.js");
var readings_downloader = require("./readings_downloader.js");
var env = require("./env.js");

//config ======================================================================

mu.root = __dirname + "/" + env.templates_dir; //template location
var servers = ["utopia", "smp1", "smp2", "smp3", "smp4", "smp5", "smp6", "smp7", "smp8", "smp9"];
var worlds = [
	{
		value: "wilderness",
		display_text: "frontier (wild)",
		id: "0"
	},
	{
		value: "wilderness_nether",
		display_text: "frontier (nether)",
		id: "-1"
	},
	{
		value: "town",
		display_text: "town",
		id: "0"
	},
	{
		value: "wastelands",
		display_text: "wastelands (wild)",
		id: "0"
	},
	{
		value: "wastelands_nether",
		display_text: "wastelands (nether)",
		id: "-1"
	},
];
			
//express =====================================================================

var app = express();
app.use(express.static(__dirname + "/" + env.static_dir));
app.use(express.logger(env.env));
//app.use(express.compress());
//app.use(express.bodyParser({keepExtensions:true}));
app.get("/", on_get_request);
app.get("*", send_404);

//database ====================================================================

console.log("Connecting to the database...");
db.init(function(err){
	if (err){
		console.error("Error starting the database:");
		console.error(err);
		process.exit(-1);
	}

	//start downloaders========================================================
	console.log("Starting readings downloaders...");
	readings_downloader.start(servers, env.readings.download_interval, on_reading_downloaded);
	
	//start "delete old readings" job
	console.log("Starting old readings remover...");
	var remove_old_readings = function(){
		db.remove_old_readings(env.readings.max_age, function(err){
			if (err){
				console.error("Error deleting old readings (max_age = " + env.readings.max_age + "):");
				console.error(err);
			}
		});
	};
	remove_old_readings();
	setInterval(remove_old_readings, env.readings.clear_interval);
	
	//compile templates========================================================
	console.log("Compiling templates...");
	var templates = ["index-top.html", "reading.html", "index-bottom.html"];
	compile_templates(templates, function(err, results){
		if (err){
			console.error("Error compiling templates:");
			console.error(err);
			process.exit(-1);
		}
		
		//start the web server=================================================
		console.log("Starting web server...");
		app.listen(8080);
		console.log("Ready.");
	});
});

//=============================================================================

/**
 * Handles a GET request.
 * @param {object} req the HTTP request
 * @param {object} res the HTTP response
 */
function on_get_request(req, res){
	if (Object.keys(req.query).length == 0){
		var data = build_data("smp7", "wilderness");
		send_response(res, data);
		return;
	}
	
	var errors = [];

	var server = s(req.query.server);
	if (!server){
		errors.push("Please select a server.");
	} else if (servers.indexOf(server) < 0){
		errors.push("Invalid server selected.");
	}
	
	var selectedWorld = null;
	var world = s(req.query.world);
	if (!world){
		errors.push("Please select a world.");
	} else {
		worlds.some(function(w){
			if(world == w.value){
				selectedWorld = w;
				return true;
			}
			return false;
		});
		if (selectedWorld == null){
			errors.push("Invalid world selected.");
		}
	}
	
	var startTime = s(req.query.startTime);
	var endTime = s(req.query.endTime);
	if (!startTime || !endTime){
		errors.push("A start time and end time are required.");
	} else {
		startTimeTs = moment(startTime);
		endTimeTs = moment(endTime);
		if (!startTimeTs.isValid() || !endTimeTs.isValid()){
			errors.push("Invalid start/end times.");
		} else {
			//truncate time component from start date string if it's midnight
			if (startTimeTs.hour() == 0 && startTimeTs.minute() == 0){
				startTime = req.query.startTime = startTimeTs.format("YYYY-MM-DD");
			}
			
			//truncate time component from end date string if it's midnight
			//also, include the entirety of the end date inside of the date range because this (most likely) means that the user didn't select a time
			if (endTimeTs.hour() == 0 && endTimeTs.minute() == 0){
				endTime = req.query.endTime = endTimeTs.format("YYYY-MM-DD");
				endTimeTs.add('days', 1);
			}
			
			if (endTimeTs.isBefore(startTimeTs)){
				errors.push("Start time must come before end time.");
			} else if (endTimeTs.diff(startTimeTs) > 1000 * 60 * 60 * 24 * 7){
				errors.push("Time span cannot be longer than 1 week.");
			}
		}
	}
	
	var x1 = s(req.query.x1);
	var z1 = s(req.query.z1);
	var x2 = s(req.query.x2);
	var z2 = s(req.query.z2);
	
	var coords = [x1, z1, x2, z2];
	var coordsEntered = 0;
	coords.forEach(function(coord){
		if (coord !== ""){
			coordsEntered++;
		}
	});
	if (coordsEntered == 4){
		coords.some(function(coord){
			if (!coord.match(/^-?\d+$/)){
				errors.push("Coordinates must be numeric and without decimals.");
				return true;
			}
			return false;
		});
	} else if (coordsEntered > 0){
		errors.push("Some coordinates are missing values.");
	}
	
	var players = s(req.query.players);
	var minimap = req.query.minimap !== undefined;
	
	if (errors.length > 0){
		var data = build_data(server, world, req.query, errors);
		send_response(res, data);
		return;
	}

	var options = {};
	if (coordsEntered == 4){
		options.x1 = parseInt(x1);
		options.z1 = parseInt(z1);
		options.x2 = parseInt(x2);
		options.z2 = parseInt(z2);
	}
	if (players){
		options.players = players.split(/\s*,\s*/);
	}
	
	var data = build_data(server, world, req.query);
	data.has_readings = true;
	data.readings = [];
	
	var waypoints = (minimap) ? wp.create() : null;
	
	var count = 0;
	db.get_readings(server, world, startTimeTs.valueOf(), endTimeTs.valueOf(), options, function(err, reading){
		if (err){
			send_error(res, err);
			return;
		}
		
		if (!reading){
			//no more results
			data.readings_length = data.readings.length;
			if (waypoints){
				var filename = waypoints.build_filename(server, selectedWorld.id);
				data.minimap_data = {text:waypoints.text, filename:filename};
			}
			send_response(res, data);
			return;
		}

		if (reading.gap_start){
			reading.gap_start = moment(reading.gap_start).format("YYYY-MM-DD HH:mm");
			reading.gap_end = moment(reading.gap_end).format("YYYY-MM-DD HH:mm");
		} else {
			reading.ts = moment(reading.ts).format("YYYY-MM-DD HH:mm");
			reading.players.forEach(function(player){
				player.odd = (count % 2 == 1);
				player.portrait_url = "http://" + server + ".empire.us:8880/tiles/faces/16x16/" + encodeURIComponent(player.name) + ".png";
				
				if (waypoints){
					waypoints.add(player);
				}
				
				count++;
			});
		}
		data.readings.push(reading);
	});
}

/**
 * Sanitizes a query string parameter.
 * @param {string} value the string to sanitize
 * @return {string} the sanitized string
 */
function s(value){
	return (value === null || typeof value === "undefined") ? "" : value.trim();
}

/**
 * Sends a 404 response
 * @param {object} req the HTTP request
 * @param {object} res the HTTP response
 */
function send_404(req, res){
	res.writeHead(404, {"Content-type": "text/plain"});
	res.end("Not found: " + req.url);
}

/**
 * Sends a 200 response.
 * @param {object} res the HTTP response
 * @param {object} data the template data
 */
function send_response(res, data){
	res.setMaxListeners(700);
	res.writeHead(200, {"Content-type": "text/html"});
	
	/*
	var stream = mu.compileAndRender("index.html", data);
	stream.pipe(res);
	*/
	
	var stream = mu.compileAndRender("index-top.html", data); //note: "compileAndRender" only compiles if it hasn't already been compiled
	stream.pipe(res, { end: false });
	
	if (data.readings){
		data.readings.forEach(function(reading){
			var stream = mu.compileAndRender("reading.html", reading);
			stream.pipe(res, { end: false });
		});
	}
	
	stream = mu.compileAndRender("index-bottom.html", data);
	stream.pipe(res, { end: true });
}

/**
 * Sends a 500 response.
 * @param {object} res the HTTP response
 * @param {object} err the error
 */
function send_error(res, err){
	res.writeHead(500, {"Content-type": "text/plain"});
	res.end("Error: " + JSON.stringify(err, null, 2));
}

/**
 * Builds an object for populating the template.
 * @param {string} [selectedServer] the server that the user selected
 * @param {string} [selectedWorld] the world that the user selected
 * @param {object} [qs] the request's query string
 * @param {array(string)} [errors] the form validation errors
 * @return {object} the data object
 */
function build_data(selectedServer, selectedWorld, qs, errors){
	var data = {
		//errors
		errors: errors,

		//static data
		servers: [],
		worlds: [],
		data_start_date: moment(Date.now() - env.readings.max_age).format("YYYY-MM-DD HH:mm"),
		gmt_offset: null,
		
		//data to be populated
		has_readings: false,
		readings_length: 0,
		minimap_data: null,
		readings: null
	};
	
	var zone = moment().zone();
	if (zone == 0){
		data.gmt_offset = " ";
	} else {
		var hourOffset = (zone / 60) * -1;
		if (hourOffset > 0){
			hourOffset = "+" + hourOffset;
		}
		data.gmt_offset = hourOffset;
	}
	
	servers.forEach(function(server){
		var obj = {
			name: server,
			selected: (selectedServer === undefined) ? false : (server == selectedServer)
		};
		data.servers.push(obj);
	});
	
	worlds.forEach(function(world){
		var copy = JSON.parse(JSON.stringify(world));
		copy.selected = (selectedWorld === undefined) ? false : (world.value == selectedWorld);
		data.worlds.push(copy);
	});
	
	//re-populate form fields
	if (qs){
		data.server = qs.server,
		data.world = qs.world,
		data.startTime = qs.startTime,
		data.endTime = qs.endTime,
		data.x1 = qs.x1,
		data.x2 = qs.x2,
		data.z1 = qs.z1,
		data.z2 = qs.z2,
		data.players = qs.players,
		data.minimap = qs.minimap !== undefined;
	}

	//convert empty fields to a string with a single space because in nodejitsu, empty strings cause mustashe to fail ??
	var fields = ["startTime", "endTime", "x1", "z1", "x2", "z2", "players"];
	fields.forEach(function(field){
		if (!data[field]){
			data[field] = " ";
		}
	});
	
	return data;
}

/**
 * Called when a map reading is downloaded.
 * @param {object} err error object
 * @param {string} server the server that the reading comes from (e.g. "smp1")
 * @param {object} reading the map reading that was downloaded
 */
function on_reading_downloaded(err, server, reading){
	if (err){
		console.error("Error downloading reading from server " + server + ":");
		console.error(err);
		return;
	}
	
	db.insert_reading(server, reading, function(err){
		if (err){
			console.error("Error inserting reading from server " + server + " into database:");
			console.error(err);
			return;
		}
	});
}

/**
 * Compiles the Mustashe templates.
 * @param {array(string)} templates the template file names
 * @param {function} callback(err, results)
 */
function compile_templates(templates, callback){
	var functions = [];
	templates.forEach(function(template){
		functions.push(function(cb){
			mu.compile(template, cb);
		});
	});
	async.parallel(functions, callback);
}
