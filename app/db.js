var mongodb = require("mongodb");
var async = require("async");
var env = require("./env.js");

var port = env.db.port ? env.db.port : mongodb.Connection.DEFAULT_PORT;
var db = new mongodb.Db(env.db.name, new mongodb.Server(env.db.host, port, {auto_reconnect:true, poolSize:env.db.pool_size}), {w:1});

var default_gap_interval = 1000*60*3; //3 min

exports.readings = null;

/**
 * Opens a connection with the database.
 * @param {function} callback(err)
 * --@param {err} the error object
 */
exports.init = function(callback){
	async.waterfall([
		function(cb){
			db.open(cb);
		},
		function(opened_db, cb){
			if (env.db.username){
				db.authenticate(env.db.username, env.db.password, cb);
			} else {
				cb(null, null);
			}
		},
		function(result, cb){
			db.collection("readings", cb);
		},
		function(collection, cb){
			exports.readings = collection;
			exports.readings.ensureIndex({timestamp:1}, cb);
		},
		function(index_name, cb){
			exports.readings.ensureIndex({server:1}, cb);
		}
	], callback);
};

/**
 * Inserts a map reading into the database.
 * @param {string} server the server that the reading is from (e.g. "smp1")
 * @param {object} reading the map reading
 * @param {function} callback(err)
 * --@param {err} the error object
 */
exports.insert_reading = function(server, reading, callback){
	//delete unneeded fields
	sanitize_reading(reading);
	
	//add server
	reading.server = server;
	
	exports.readings.insert(reading, {w:1, safe:true}, callback);
};

function sanitize_reading(reading){
	delete reading.updates;
	
	if (Array.isArray(reading.players)){
		reading.players.forEach(function(player){
			delete player.sort;
			delete player.armor;
			delete player.account;
			delete player.health;
			delete player.type;
		});
	}
}

/**
 * Retrieves map readings from the database.
 * @param {string} server the server (e.g. "smp1")
 * @param {string} world the world (e.g. "wilderness")
 * @param {number} startTime the start timestamp
 * @param {number} endTime the end timestamp
 * @param {object} options
 * --@param {number} gap_interval if a gap in the server data of this length (in milliseconds, 3 minutes by default) is found, then a "gap" result will be returned in the results to show that no data exists for this time span
 * --@param {number} x1 the x-coord of one of the corners of the bounded area
 * --@param {number} z1 the z-coord of one of the corners of the bounded area
 * --@param {number} x2 the x-coord of the opposite corner of the bounded area
 * --@param {number} z2 the z-coord of the opposite corner of the bounded area
 * --@param {array(string)} players the players to search for
 * @param {function} callback(err, reading)
 * --@param {object} err the error object
 * --@param {object} reading the next reading (or gap) that was read or null if there are no more readings
 */
exports.get_readings = function(server, world, startTime, endTime, options, callback){
	world = world.toLowerCase();
	
	if (!options.gap_interval){
		options.gap_interval = default_gap_interval;
	}
	
	var query = {
		timestamp: {$gte: startTime, $lte: endTime},
		server: server
	};

	var hasCoords =
	options.x1 !== undefined &&
	options.x2 !== undefined &&
	options.z1 !== undefined &&
	options.z2 !== undefined;
	
	var prevTs = startTime;
	exports.readings.find(query, ["timestamp", "players"]).sort({timestamp:1}).each(function(err, reading){
		if (err){
			callback(err);
			return;
		}
		
		if (!reading){
			//no more results
			
			//check for a data gap
			var diff = endTime - prevTs;
			if (diff > options.gap_interval){
				if (prevTs != startTime){
					prevTs += 60;
				}
				callback(null, {gap_start:prevTs, gap_end:endTime});
			}
			
			callback(null, null);
			return;
		}

		var ts = reading.timestamp;
		
		//check for a data gap
		var diff = ts - prevTs;
		if (diff > options.gap_interval){
			if (prevTs != startTime){
				prevTs += 60;
			}
			callback(null, {gap_start:prevTs, gap_end:ts-60});
		}
		
		prevTs = ts;
		
		if (reading.players === undefined || !Array.isArray(reading.players) || reading.players.length == 0){
			return;
		}
		
		var players = [];
		reading.players.forEach(function(player){
			if (player.world.toLowerCase() != world){
				return;
			}
			
			var matchedCoords = true;
			if (hasCoords){
				x = player.x;
				z = player.z;
				
				matchedCoords =
				(options.x1 <= x && x <= options.x2 || options.x2 <= x && x <= options.x1) &&
				(options.z1 <= z && z <= options.z2 || options.z2 <= z && z <= options.z1);
			}
			
			var matchedPlayer = true;
			if (options.players !== undefined && Array.isArray(options.players) && options.players.length > 0){
				var jsonPlayer = player.name.toLowerCase();
				matchedPlayer = options.players.some(function(inputPlayer){
					return jsonPlayer.indexOf(inputPlayer.toLowerCase()) >= 0;
				});
			}
			
			if (matchedCoords && matchedPlayer){
				players.push(player);
			}
		});
		if (players.length > 0){
			callback(null, {ts:ts, players:players});
		}
	});
};
