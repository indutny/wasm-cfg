'use strict';

function Signature(result, params) {
  this.result = result;
  this.params = params;
}

function register(result, name, a, b) {
  var inputs;
  if (a === undefined)
    inputs = [];
  else if (b === undefined)
    inputs = [ a ];
  else
    inputs = [ a, b ];
  exports[result + '.' + name] = new Signature(result, inputs);
}

// Integers

var types = [ 'i8', 'i16', 'i32', 'i64' ];

var binary = [
  'add', 'sub', 'mul', 'div_s', 'div_u', 'rem_s', 'rem_u',
  'and', 'or', 'xor', 'shl', 'shr_u', 'shr_s', 'eq', 'ne',
  'lt_s', 'le_s', 'lt_u', 'le_u', 'gt_s', 'ge_s', 'gt_u', 'ge_u'
];

var unary = [
  'clz', 'ctz', 'popcnt'
];

types.forEach(function(type) {
  binary.forEach(function(op) {
    register(type, op, type, type);
  });
  unary.forEach(function(op) {
    register(type, op, type);
  });

  register(type, 'const');
});

// Floating Point

var ftypes = [ 'f32', 'f64' ];

var fbinary = [
  'add', 'sub', 'mul', 'div', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'min', 'max'
];

var funary =  [
  'abs', 'neg', 'copysign', 'ceil', 'floor', 'trunc', 'nearest', 'sqrt'
];

ftypes.forEach(function(type) {
  fbinary.forEach(function(op) {
    register(type, op, type, type);
  });
  funary.forEach(function(op) {
    register(type, op, type);
  });

  register(type, 'const');
});

// Conversions
register('i32', 'wrap', 'i64');
register('i32', 'trunc_s', 'f32');
register('i32', 'trunc_s', 'f64');
register('i32', 'trunc_u', 'f32');
register('i32', 'trunc_u', 'f64');
register('i32', 'reinterpret', 'f32');
register('i64', 'extend_s', 'i32');
register('i64', 'extend_u', 'i32');
register('i64', 'trunc_s', 'f32');
register('i64', 'trunc_s', 'f64');
register('i64', 'trunc_u', 'f32');
register('i64', 'trunc_u', 'f64');
register('i64', 'reinterpret', 'f64');
register('f32', 'demote', 'f64');
register('f32', 'convert_s', 'i32');
register('f32', 'convert_s', 'i64');
register('f32', 'convert_u', 'i32');
register('f32', 'convert_u', 'i64');
register('f32', 'reinterpret', 'i32');
register('f64', 'promote', 'f32');
register('f64', 'convert_s', 'i32');
register('f64', 'convert_s', 'i64');
register('f64', 'convert_u', 'i32');
register('f64', 'convert_u', 'i64');
register('f64', 'reinterpret', 'i64');

console.log(exports);
