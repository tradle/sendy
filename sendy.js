var EventEmitter = require('events').EventEmitter
var util = require('util')
var varint = require('varint')
var lps = require('length-prefixed-stream')
var utils = require('./utils')
var Connection = require('./connection')
var UINT32 = 0xffffffff

function LengthPrefixed (opts) {
  var self = this

  opts = opts || {}

  EventEmitter.call(this)

  this._connection = opts.connection || new Connection(opts)
  this._connection.once('destroy', function () {
    self._destroyed = true
    self._connection = null
  })

  this._queued = 0
  this._deliveryCallbacks = {}

  this._connection.on('send', function (msg) {
    self.emit('send', msg)
  })

  this._decoder = lps.decode()
  this._connection.on('receive', function (lengthPrefixedData) {
    self._decoder.write(lengthPrefixedData)
  })

  this._decoder.on('data', function (data) {
    self.emit('message', data)
  })

  var id = 0
  this._nextCallbackId = function () {
    return '' + (id++ & UINT32)
  }
}

util.inherits(LengthPrefixed, EventEmitter)
exports = module.exports = LengthPrefixed

LengthPrefixed.prototype.receive = function (data) {
  this._connection.receive(data)
}

LengthPrefixed.prototype.send = function (msg, cb) {
  var self = this

  if (cb) {
    this._deliveryCallbacks[this._nextCallbackId()] = {
      count: ++this._queued,
      callback: cb
    }
  }

  var data = utils.toBuffer(msg)
  var length = new Buffer(varint.encode(data.length))
  var totalLength = data.length + length.length

  this._connection.send(Buffer.concat([length, data], totalLength), function () {
    self._queued--
    for (var id in self._deliveryCallbacks) {
      var waiter = self._deliveryCallbacks[id]
      if (--waiter.count === 0) {
        delete self._deliveryCallbacks[id]
        waiter.callback()
      }
    }
  })
}

LengthPrefixed.prototype.destroy = function () {
  if (this._connection) {
    this._connection.destroy()
    // nulled in 'destroy' handler too
    // but this prevents subsequent destroy calls
    this._connection = null
  }
}