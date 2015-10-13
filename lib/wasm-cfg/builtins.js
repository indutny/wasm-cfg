'use strict';

var wasmCFG = require('../wasm-cfg');
var Signature = wasmCFG.Signature;
var effects = wasmCFG.effects;

function register(result, name, a, b) {
  var inputs;
  if (a === undefined)
    inputs = [];
  else if (b === undefined)
    inputs = [ a ];
  else
    inputs = [ a, b ];
  var key = result + '.' + name;
  if (exports[key])
    throw new Error(key + ' : redefined');

  var sig = new Signature(result, inputs);
  exports[key] = sig;
  return sig;
}

function registerEffect(effect, result, name, a, b) {
  var sig = register(result, name, a, b);
  sig.effect |= effects['EFFECT_' + effect];
  return sig;
}

// Integers

var types = [ 'i32', 'i64' ];

var binary = [
  'add', 'sub', 'mul', 'div_s', 'div_u', 'rem_s', 'rem_u',
  'and', 'or', 'xor', 'shl', 'shr_u', 'shr_s'
];
var bool = [
  'eq', 'ne', 'lt_s', 'le_s', 'lt_u', 'le_u', 'gt_s', 'ge_s', 'gt_u', 'ge_u'
];

var unary = [
  'clz', 'ctz', 'popcnt'
];

types.forEach(function(type) {
  binary.forEach(function(op) {
    register(type, op, type, type);
  });
  bool.forEach(function(op) {
    register(type, op, type, type).result = 'bool';
  });
  unary.forEach(function(op) {
    register(type, op, type);
  });

  register(type, 'const');
});

register('addr', 'from_32', 'i32');
register('addr', 'from_64', 'i64');
register('i64', 'from_addr', 'addr');
register('i32', 'from_addr', 'addr');

// Floating Point

var ftypes = [ 'f32', 'f64' ];

var fbinary = [
  'add', 'sub', 'mul', 'div', 'min', 'max', 'copysign'
];
var fbool = [
  'eq', 'ne', 'lt', 'le', 'gt', 'ge'
];

var funary =  [
  'abs', 'neg', 'ceil', 'floor', 'trunc', 'nearest', 'sqrt'
];

ftypes.forEach(function(type) {
  fbinary.forEach(function(op) {
    register(type, op, type, type);
  });
  fbool.forEach(function(op) {
    register(type, op, type, type).result = 'bool';
  });
  funary.forEach(function(op) {
    register(type, op, type);
  });

  register(type, 'const');
});

// Conversions
register('i32', 'wrap', 'i64');
register('i32', 'trunc_s_32', 'f32');
register('i32', 'trunc_s_64', 'f64');
register('i32', 'trunc_u_32', 'f32');
register('i32', 'trunc_u_64', 'f64');
register('i32', 'reinterpret', 'f32');
register('i64', 'extend_s', 'i32');
register('i64', 'extend_u', 'i32');
register('i64', 'trunc_s_32', 'f32');
register('i64', 'trunc_s_64', 'f64');
register('i64', 'trunc_u_32', 'f32');
register('i64', 'trunc_u_64', 'f64');
register('i64', 'reinterpret', 'f64');
register('f32', 'demote', 'f64');
register('f32', 'convert_s_32', 'i32');
register('f32', 'convert_s_64', 'i64');
register('f32', 'convert_u_32', 'i32');
register('f32', 'convert_u_64', 'i64');
register('f32', 'reinterpret', 'i32');
register('f64', 'promote', 'f32');
register('f64', 'convert_s_32', 'i32');
register('f64', 'convert_s_64', 'i64');
register('f64', 'convert_u_32', 'i32');
register('f64', 'convert_u_64', 'i64');
register('f64', 'reinterpret', 'i64');

// Loads
[ 'i32', 'i64', 'f32', 'f64' ].forEach(function(type) {
  registerEffect('MEMORY_LOAD', type, 'load', 'addr');
  registerEffect('MEMORY_STORE', type, 'store', 'addr', type);
  if (type === 'i32' || type === 'i64') {
    registerEffect('MEMORY_LOAD', type, 'load8_s', 'addr');
    registerEffect('MEMORY_LOAD', type, 'load8_u', 'addr');
    registerEffect('MEMORY_LOAD', type, 'load16_s', 'addr');
    registerEffect('MEMORY_LOAD', type, 'load16_u', 'addr');
    registerEffect('MEMORY_STORE', type, 'store8', 'addr', type);
    registerEffect('MEMORY_STORE', type, 'store16', 'addr', type);
  }
});
registerEffect('MEMORY_LOAD', 'i64', 'load32_s', 'addr');
registerEffect('MEMORY_LOAD', 'i64', 'load32_u', 'addr');
registerEffect('MEMORY_STORE', 'i64', 'store32', 'addr', 'i32');

register('addr', 'page_size');
