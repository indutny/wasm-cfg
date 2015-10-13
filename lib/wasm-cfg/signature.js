'use strict';

function Signature(result, params) {
  this.effect = 0;
  this.result = result;
  this.params = params;
  this.public = false;
}
module.exports = Signature;
