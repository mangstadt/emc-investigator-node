module.exports = {
	db: {
		host: process.env.DB_HOST ? process.env.DB_HOST : "localhost",
		name: process.env.DB_NAME ? process.env.DB_NAME : "emc-investigator",
		username: process.env.DB_USERNAME ? process.env.DB_USERNAME : null,
		password: process.env.DB_PASSWORD ? process.env.DB_PASSWORD : null,
		port: process.env.DB_PORT ? process.env.DB_PORT : null,
		pool_size: 5
	},
	static_dir: "static/",
	templates_dir: "templates/",
	env: "dev",
	readings: {
		download_interval: 1000*60, //1 minute
		clear_interval: 1000*60*60, //1 hour 
		max_age: 1000*60*60*24*14 //2 weeks
	}
};
