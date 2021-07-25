let defs = require('./defs'),
  commands = defs.commands,
  commandsById = defs.commandsById,
  tlvs = defs.tlvs,
  tlvsById = defs.tlvsById,
  Buffer = require('safer-buffer').Buffer;

const pduHeadParams = [
  'command_length',
  'command_id',
  'command_status',
  'sender_id',
  'receiver_id'
];

function PDU(command, options) {
  if (Buffer.isBuffer(command)) {
    return this.fromBuffer(command);
  }
  options = options || {};
  this.command = command;
  this.command_length = 0;
  this.command_id = commands[command].id;
  this.command_status = options.command_status || 0x00000000;
  this.sender_id = options.sender_id || 0xFFFFFFFF;
  this.receiver_id = options.receiver_id || 0xFFFFFFFF;
  // this.sequence_number = options.sequence_number || 0;
  if (this.command_status) {
    return;
  }
  let params = commands[command].params || {};
  for (let key in params) {
    if (key in options) {
      this[key] = options[key];
    } else if ('default' in params[key]) {
      this[key] = params[key].default;
    } else {
      this[key] = params[key].type.default;
    }
  }
  for (let key in options) if (key in tlvs) {
    this[key] = options[key];
  }
}

PDU.commandLength = function (stream) {
  let buffer = stream.read(4);
  if (!buffer) {
    return false;
  }
  let command_length = buffer.readUInt32BE(0);
  if (command_length > PDU.maxLength) {
    throw Error('PDU length was too large (' + command_length +
      ', maximum is ' + PDU.maxLength + ').');
  }
  return command_length;
};

PDU.fromStream = function (stream, command_length) {
  let buffer = stream.read(command_length - 4);
  if (!buffer) {
    return false;
  }
  let commandLengthBuffer = Buffer.alloc(4);
  commandLengthBuffer.writeUInt32BE(command_length, 0);
  let pduBuffer = Buffer.concat([commandLengthBuffer, buffer]);

  return new PDU(pduBuffer);
};

PDU.fromBuffer = function (buffer) {
  if (buffer.length < 16 || buffer.length < buffer.readUInt32BE(0)) {
    return false;
  }
  return new PDU(buffer);
};

PDU.prototype.isResponse = function () {
  return !!(this.command_id & 0x80000000);
};

PDU.prototype.response = function (options) {
  options = options || {};
  // options.sequence_number = this.sequence_number;
  if (this.command == 'unknown') {
    if (!('command_status' in options)) {
      options.command_status = defs.errors.ESME_RINVCMDID;
    }
    return new PDU('generic_nack', options);
  }
  return new PDU(this.command + '_resp', options);
};

PDU.prototype.fromBuffer = function (buffer) {
  pduHeadParams.forEach(function (key, i) {
    this[key] = buffer.readUInt32BE(i * 4);
  }.bind(this));

  // Log PDU Header
  // console.log(this)
  // pduHeadParams.forEach(function (key, i) {
  //   buf = Buffer.alloc(4)
  //   buffer.copy(buf, 0, i * 4)
  //   console.log(`${key}:`, buf)
  //   console.log(buf.readUInt32BE())
  // }.bind(this));
  //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
  //pduHeadParams*4, its better to use that basis for maintainance.
  let params, offset = pduHeadParams.length * 4;
  if (this.command_length > PDU.maxLength) {
    throw Error('PDU length was too large (' + this.command_length +
      ', maximum is ' + PDU.maxLength + ').');
  }
  if (commandsById[this.command_id]) {
    this.command = commandsById[this.command_id].command;
    params = commands[this.command].params || {};
  } else {
    this.command = 'unknown';
    return;
  }
  for (let key in params) {
    if (offset >= this.command_length) {
      break;
    }
    this[key] = params[key].type.read(buffer, offset);
    offset += params[key].type.size(this[key]);
  }
  while (offset + 4 <= this.command_length) {
    let tlvId = buffer.readUInt16BE(offset);
    let length = buffer.readUInt16BE(offset + 2);
    offset += 4;
    let tlv = tlvsById[tlvId];
    if (!tlv) {
      this[tlvId] = buffer.slice(offset, offset + length);
      offset += length;
      continue;
    }
    let tag = (commands[this.command].tlvMap || {})[tlv.tag] || tlv.tag;
    if (tlv.multiple) {
      if (!this[tag]) {
        this[tag] = [];
      }
      this[tag].push(tlv.type.read(buffer, offset, length));
    } else {
      this[tag] = tlv.type.read(buffer, offset, length);
    }
    offset += length;
  }
  this._filter('decode');
};

PDU.prototype._filter = function (func) {
  let params = commands[this.command].params || {};
  for (let key in this) {
    if (params[key] && params[key].filter) {
      this[key] = params[key].filter[func].call(this, this[key]);
    } else if (tlvs[key] && tlvs[key].filter) {
      if (tlvs[key].multiple) {
        this[key].forEach(function (value, i) {
          this[key][i] = tlvs[key].filter[func].call(this, value, true);
        }.bind(this));
      } else {
        if (key === 'message_payload') {
          skipUdh = this.short_message && this.short_message.message && this.short_message.message.length;
          this[key] = tlvs[key].filter[func].call(this, this[key], skipUdh);
        } else {
          this[key] = tlvs[key].filter[func].call(this, this[key], true);
        }
      }
    }
  }
};

PDU.prototype._initBuffer = function () {
  let buffer = Buffer.alloc(this.command_length);
  pduHeadParams.forEach(function (key, i) {
    buffer.writeUInt32BE(this[key], i * 4);
  }.bind(this));
  return buffer;
};

PDU.prototype.toBuffer = function () {
  //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
  //pduHeadParams*4, its better to use that basis for maintainance.

  //Create Buffer Allocation for Header
  this.command_length = pduHeadParams.length * 4;
  if (this.command_status) {
    return this._initBuffer();
  }
  this._filter('encode');
  //Create Buffer Allocation for Body
  let params = commands[this.command].params || {};
  for (let key in this) {
    if (params[key]) {
      this.command_length += params[key].size;
    } else if (tlvs[key]) {
      let values = tlvs[key].multiple ? this[key] : [this[key]];
      values.forEach(function (value) {
        this.command_length += tlvs[key].type.size(value) + 4;
      }.bind(this));
    }
  }
  let buffer = this._initBuffer();

  // Log PDU Header
  // console.log(this)
  // pduHeadParams.forEach(function (key, i) {
  //   buf = Buffer.alloc(4)
  //   buffer.copy(buf, 0, i * 4)
  //   console.log(`${key}:`, buf)
  //   console.log(buf.readUInt32BE())
  // }.bind(this));


  //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
  //pduHeadParams*4, its better to use that basis for maintainance.
  let offset = pduHeadParams.length * 4;
  for (let key in params) {
    let keySize = params[key].size
    params[key].type.write(this[key], buffer, offset);
    offset += keySize;
  }
  for (let key in this) if (tlvs[key]) {
    let values = tlvs[key].multiple ? this[key] : [this[key]];
    values.forEach(function (value) {
      buffer.writeUInt16BE(tlvs[key].id, offset);
      let length = tlvs[key].type.size(value);
      buffer.writeUInt16BE(length, offset + 2);
      offset += 4;
      tlvs[key].type.write(value, buffer, offset);
      offset += length;
    });
  }

  // offset = pduHeadParams.length * 4;
  // for (let key in params) {
  //   let keySize = params[key].size
  //   buf = Buffer.alloc(keySize)
  //   buffer.copy(buf, 0, offset)
  //   offset += keySize
  //   console.log(`${key}:`, buf)
  //   console.log(params[key].type.read(buf, 0))
  // }
  // console.log(buffer.toString('hex').match(/../g).join(' '))
  // console.log(buffer)

  return buffer;
};

PDU.maxLength = 16384;

exports.PDU = PDU;
