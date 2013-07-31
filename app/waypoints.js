/**
 * Creates a new waypoints object.
 * @return object the object
 */
exports.create = function(){
	return new Waypoints();
};

function Waypoints(){
	this.cur_color = 0;
	this.text = "";
	this.player_colors = {};
	this.count = 0;
}

Waypoints.prototype.colors = ["FF0000", "00FF00", "0000FF", "00FFFF", "FF00FF", "FFFF00", "FFFFFF", "000000"];

/**
 * Adds a waypoint to the waypoints list.
 * @param object player the player to add
 */
Waypoints.prototype.add = function(player){
	if (this.count > 200){
		//TODO mustashe stops processing the template if it gets too big
		return;
	}

	//get the player's color
	var color = null;
	if (this.player_colors[player.name]){
		color = this.player_colors[player.name];
	} else {
		color = this.colors[this.cur_color++];
		this.player_colors[player.name] = color;
		if (this.cur_color >= this.colors.length){
			this.cur_color = 0;
		}
	}
	
	var components = [
		player.name.replace(":", " "),
		player.x,
		player.y,
		player.z,
		"true", //visible
		color
	];
	
	this.text += components.join(":") + "\n";
	this.count++;
};

/**
 * Generates the filename of a waypoint file.
 * @param string server the EMC server (e.g. "smp7")
 * @param numeric id the world ID (e.g. "0")
 * @return string the filename
 */
Waypoints.prototype.build_filename = function(server, id){
	return server + ".empire.us.DIM" + id + ".points";
};
