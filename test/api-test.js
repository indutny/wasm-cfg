'use strict';

var assert = require('assert');
var assertText = require('assert-text');
assertText.options.trim = true;
var fixtures = require('./fixtures');

// TODO(indutny): dev dependency
var wasmAST = require('wasm-ast');

var wasmCFG = require('../');

function test(source, expected) {
  var ast = wasmAST.parse(fixtures.fn2str(source), {
    index: true
  });
  var cfgs = wasmCFG.build(ast);

  var out = cfgs.map(function(cfg, index) {
    return cfg.render({ cfg: true }, 'printable')
              .replace(/pipeline/, 'pipeline ' + index);
  }).join('\n');

  assertText.equal(out, fixtures.fn2str(expected));
}

describe('wasm-cfg', function() {
  it('should construct linear CFG', function() {
    test(function() {/*
      i64 op(i64 a, i64 b) {
        return i64.mul(i64.add(a, b), i64.const(1));
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.param 0
          i1 = i64.param 1
          i2 = i64.add i0, i1
          i3 = i64.const 1
          i4 = i64.mul i2, i3
          i5 = i64.ret i4
        }
      }
    */});
  });

  it('should do not allow return from void', function() {
    assert.throws(function() {
      test(function() {/*
        void op(i64 a) {
          return a;
        }
      */}, function() {/*
      */});
    }, /Return from `void`/);
  });

  it('should check return type', function() {
    assert.throws(function() {
      test(function() {/*
        i32 op(i64 a) {
          return a;
        }
      */}, function() {/*
      */});
    }, /Mismatched param type/);
  });

  it('should check builtin result type', function() {
    assert.throws(function() {
      test(function() {/*
        i32 op(i64 a, i64 b) {
          return i64.mul(a, b);
        }
      */}, function() {/*
      */});
    }, /Builtin return type mismatch/);
  });

  it('should check builtin arg type', function() {
    assert.throws(function() {
      test(function() {/*
        i64 op(i64 a, i32 b) {
          return i64.mul(a, b);
        }
      */}, function() {/*
      */});
    }, /Mismatched param type/);
  });
});
