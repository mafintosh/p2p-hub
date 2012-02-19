var common = require('common');
var sockets = require('message-sockets');

var noop = function() {};

var Peer = common.emitter(function(hub, socket) {
	var self = this;
	var types = {};

	this.address = null;
	this.onconnect = common.future();

	if (typeof socket === 'string') {
		this.address = socket;
		this.onconnect.put(this.address);
		socket = sockets.connect(socket);
		socket.send({type:'connect', from:hub.address});
	}

	this.callbacks = {};
	this.multiplexes = {};
	this.writable = this.readable = true;
	this.socket = socket;
	this.hub = hub;

	types.connect = function(message) {
		socket.send({type:'nodes', nodes:hub.nodes()});
		self.address = message.from;
		self.emit('connect', message.from);
		self.onconnect.put(self.address);
	};
	types.nodes = function(message) {
		self.emit('nodes', message.nodes);
	};
	types.multiplex = function(message, callback) {
		var multiplexed = !!self.multiplexes[message.channel];

		if (multiplexed) {
			self.emit('multiplex', message.channel);
		}

		callback(null, multiplexed);
	};
	types.response = function(message) {
		(self.callbacks[message.id] || noop)(message.error && new Error(message.error), message.data);
	};
	types.message = function(message, callback) {
		self.emit('message', message, callback);
	};

	socket.on('close', function() {
		self.writable = self.readable = false;

		for (var i in self.callbacks) {
			self.callbacks[i](new Error('node failure'));
		}

		self.emit('close');

		if (!self.address) {
			return;
		}

		self.emit('disconnect', self.address);		
	});
	socket.on('message', function(message) {
		(types[message.type] || types.message)(message, !message.id ? noop : function(err, data) {
			socket.send({id:message.id, type:'response', error:(err && err.message), data:data});
		});
	});
});

Peer.prototype.multiplex = function(name, callback) {
	this.multiplexes[name] = name;
	this.send({type:'multiplex',channel:name}, callback);
};
Peer.prototype.send = function(message, callback) {
	if (callback) {
		var id = message.id = common.gensym();
		var callbacks = this.callbacks;

		callbacks[id] = function(err, data) {
			delete callbacks[id];
			callback(err, data);
		};
	}

	this.socket.send(message);
};
Peer.prototype.ready = function(callback) {
	this.onconnect.get(callback);
};

exports.create = function(hub, socket) {
	return new Peer(hub, socket);
};
exports.whenOnline = function(destination, callback) {
	var timeout = 100;

	var onclose = function() {
		setTimeout(action, timeout = 2*timeout);
	};
	var action = function() {
		var socket = sockets.connect(destination);

		socket.on('close', onclose);
		socket.on('open', function() {
			socket.removeListener('close', onclose);
			socket.destroy();
			
			callback();
		});
	};

	action();
};
