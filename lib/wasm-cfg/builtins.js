'use strict';

function Signature(result, params) {
  this.result = result;
  this.params = params;
}

exports['i64.add'] = new Signature('i64', [ 'i64', 'i64' ]);
exports['i64.mul'] = new Signature('i64', [ 'i64', 'i64' ]);
