var cluster = require('cluster');

if (cluster.isMaster) {
	for (var i = 0; i < 2; i++) {
		cluster.fork();
	}
}

var hub = require('./index').connect();

hub.on('connect', function(from) {
	console.log(hub.address+'> nodes: '+hub.nodes().join(', ')+' (connect)');

	hub.send('send to all (from '+hub.address+')');
	hub.send(from, 'do not answer', function(err) {
		console.log(from+'> '+(err && err.message));
	});
	hub.send(from, 'answer', function(_, message) {
		console.log(from+'> '+message);
	});
});
hub.on('disconnect', function(from) {
	console.log(hub.address+'> nodes: '+hub.nodes().join(', ')+' (disconnect)');
});
hub.on('message', function(from, message, callback) {
	console.log(from+'> '+message);

	if (message === 'answer') {
		callback(null, 'echo: '+message);
	}
});

setTimeout(function() {
	process.exit(0);
}, Math.random()*10000);