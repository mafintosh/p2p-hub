var hub = require('./index').connect();

hub.on('connect', function() {
	console.log('connect', hub.nodes());
	hub.send('*');
});
hub.on('disconnect', function() {
	console.log('disconnect', hub.nodes());
});
hub.on('message', function(from, message) {
	console.log('message', from, message);
});