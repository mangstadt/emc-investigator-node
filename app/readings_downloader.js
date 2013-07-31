var http = require("http");

/**
 * Starts the downloaders.
 * @param {array(string)} the servers to download from (e.g. "smp1", "smp2", etc)
 * @param {number} interval how often a map reading should be downloaded, in milliseconds (e.g. "1000" for every second)
 * @param {function} callback(err, server, reading)
 * --@param {object} err error object
 * --@param {string} server the server that the reading comes from (e.g. "smp1")
 * --@param {object} reading the map reading that was downloaded
 */
exports.start = function(servers, interval, callback){
	servers.forEach(function(server){
		download_reading(server, callback);
	
		setInterval(function(){
			download_reading(server, callback);
		}, interval);
	});
};

/**
 * Downloads a reading.
 * @param {string} server the server (e.g. "smp1")
 * @param {function} callback(err, server, reading)
 * --@param {object} err error object
 * --@param {string} server the server that the reading comes from (e.g. "smp1")
 * --@param {object} reading the map reading that was downloaded
 */
function download_reading(server, callback){
	var url = "http://" + server + ".empire.us:8880/up/world/wilderness/" + Date.now();
	
	http.get(url, function(res){
		var body = "";
		
		res.on("data", function(chunk){
			body += chunk;
		})
		.on("end", function(){
			try{
				obj = JSON.parse(body);
				delete obj.updates;
				callback(null, server, obj);
			} catch(e){
				callback(e);
			}
		});
	})
	.on("error", function(err){
		callback(err);
	});
};
