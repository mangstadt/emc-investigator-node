module.exports = {
	db: {
		name: "emc-investigator",
		host: "localhost",
		username: null,
		password: null,
		port: null,
		pool_size: 5
	},
	static_dir: "static/",
	templates_dir: "templates/",
	env: "dev",
	readings_interval: 1000*60
};
