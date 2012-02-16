# p2p-hub

a super simple p2p hub that allows you to send json messages between computers

``` js
var hub = require('p2p-hub').connect('json://address_to_a_member');

hub.on('connect', function(from) {
	console.log(from, 'connected');
	
	// let's print all current nodes
	var all = hub.nodes();
	
	console.log('all nodes:', all);
	
	// let's say hello to him	
	hub.send(from, {hello:'world'});
});
hub.on('disconnect', function(from) {
	console.log(from, 'disconnected');
});
hub.on('message', function(from, message) {
	console.log(from, 'says', message);
});

hub.send('json://another_member', {hello:'world'});
```

You can also multiplex messages to support multiple apps on the same hub

``` js
var hub = require('p2p-hub').connect('json://address_to_a_member');

var app = hub.multiplex('app');

app.on('connect', function(from) {
	console.log(from, 'connected to app');
	console.log('all in app:', app.nodes());
});
app.on('disconnect', function(from) {
	console.log(from, 'disconnected from app');
});
app.on('message', function(from, message) {
	console.log(from, 'in app says', message);
});
app.send('json://another_member', {hello:'app'});

```
