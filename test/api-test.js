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

  var out = cfgs.map(function(item, index) {
    item.cfg.reindex();
    item.cfg.link();
    item.cfg.verify();

    return item.cfg.render({ cfg: true }, 'printable')
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
          i0 = i64.param ^b0, 0
          i1 = i64.param ^i0, 1
          i2 = jump ^i1
        }
        b0 -> b1
        b1 {
          i3 = i64.add i0, i1
          i4 = i64.const 1
          i5 = i64.mul i3, i4
          i6 = i64.ret ^b1, i5
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

  it('should allow empty return', function() {
    test(function() {/*
      void op() {
        return;
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = ret ^b0
        }
      }
    */});
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

  it('should support SequenceExpression', function() {
    test(function() {/*
      i64 op(i64 a, i64 b) {
        return (a, b);
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.param ^b0, 0
          i1 = i64.param ^i0, 1
          i2 = jump ^i1
        }
        b0 -> b1
        b1 {
          i3 = i64.ret ^b1, i1
        }
      }
    */});
  });

  it('should support VariableDeclaration and use', function() {
    test(function() {/*
      i64 op() {
        i64 a = i64.const(123);
        return a;
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = ssa:store 0, i1
          i1 = i64.const 123
          i2 = ssa:load 0
          i3 = i64.ret ^b0, i2
        }
      }
    */});
  });

  it('should support AssignmentExpression', function() {
    test(function() {/*
      i64 op() {
        i64 a;
        i64 b;
        a = b = i64.const(1);
        return a = i64.const(2);
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.const 1
          i1 = ssa:store 1, i0
          i2 = ssa:store 0, i0
          i3 = i64.const 2
          i4 = ssa:store 0, i3
          i5 = i64.ret ^b0, i3
        }
      }
    */});
  });

  it('should support IfStatement', function() {
    test(function() {/*
      i64 op(i64 a, i64 b) {
        i64 r;
        if (a) {
          if (b)
            r = i64.const(1);
        } else {
          r = i64.const(2);
        }
        return r;
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.param ^b0, 0
          i1 = i64.param ^i0, 1
          i2 = jump ^i1
        }
        b0 -> b1
        b1 {
          i3 = i64.bool i0
          i4 = if ^b1, i3
        }
        b1 -> b2, b6
        b2 {
          i5 = i64.bool i1
          i6 = if ^b2, i5
        }
        b2 -> b3, b4
        b3 {
          i7 = i64.const 1
          i8 = ssa:store 0, i7
          i9 = jump ^b3
        }
        b3 -> b5
        b4 {
          i10 = jump ^b4
        }
        b4 -> b5
        b5 {
          i11 = jump ^b5
        }
        b5 -> b7
        b6 {
          i12 = i64.const 2
          i13 = ssa:store 0, i12
          i14 = jump ^b6
        }
        b6 -> b7
        b7 {
          i15 = ssa:load 0
          i16 = i64.ret ^b7, i15
        }
      }
    */});
  });

  it('should support consequent IfStatements', function() {
    test(function() {/*
      void op(i64 a) {
        if (a) {
        } else {
        }
        if (a) {
        } else {
        }
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = i64.param ^b0, 0
          i1 = jump ^i0
        }
        b0 -> b1
        b1 {
          i2 = i64.bool i0
          i3 = if ^b1, i2
        }
        b1 -> b2, b3
        b2 {
          i4 = jump ^b2
        }
        b2 -> b4
        b3 {
          i5 = jump ^b3
        }
        b3 -> b4
        b4 {
          i6 = jump ^b4
        }
        b4 -> b5
        b5 {
          i7 = i64.bool i0
          i8 = if ^b5, i7
        }
        b5 -> b6, b7
        b6 {
          i9 = jump ^b6
        }
        b6 -> b8
        b7 {
          i10 = jump ^b7
        }
        b7 -> b8
        b8 {
          i11 = ret ^b8
        }
      }
    */});
  });

  it('should generate empty forever loop', function() {
    test(function() {/*
      void op() {
        forever {
        }
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = jump ^b0
        }
        b0 -> b1
        b1 {
          i1 = jump ^b1
        }
        b1 -> b2
        b2 {
          i2 = jump ^b2
        }
        b2 -> b1
      }
    */});
  });

  it('should generate forever loop with breaks', function() {
    test(function() {/*
      void op() {
        forever {
          if (i64.const(1)) break;
          if (i64.const(2)) break;
          if (i64.const(3)) break;
        }
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = jump ^b0
        }
        b0 -> b1
        b1 {
          i1 = jump ^b1
        }
        b1 -> b2
        b2 {
          i2 = i64.const 1
          i3 = i64.bool i2
          i4 = if ^b2, i3
        }
        b2 -> b3, b5
        b3 {
          i5 = jump ^b3
        }
        b3 -> b4
        b4 {
          i6 = jump ^b4
        }
        b4 -> b9
        b5 {
          i7 = jump ^b5
        }
        b5 -> b6
        b6 {
          i8 = jump ^b6
        }
        b6 -> b7
        b7 {
          i9 = i64.const 2
          i10 = i64.bool i9
          i11 = if ^b7, i10
        }
        b7 -> b8, b10
        b8 {
          i12 = jump ^b8
        }
        b8 -> b9
        b9 {
          i13 = jump ^b9
        }
        b9 -> b14
        b10 {
          i14 = jump ^b10
        }
        b10 -> b11
        b11 {
          i15 = jump ^b11
        }
        b11 -> b12
        b12 {
          i16 = i64.const 3
          i17 = i64.bool i16
          i18 = if ^b12, i17
        }
        b12 -> b13, b15
        b13 {
          i19 = jump ^b13
        }
        b13 -> b14
        b14 {
          i20 = ret ^b14
        }
        b15 {
          i21 = jump ^b15
        }
        b15 -> b16
        b16 {
          i22 = jump ^b16
        }
        b16 -> b1
      }
    */});
  });

  it('should generate forever loop with continue', function() {
    test(function() {/*
      void op() {
        forever {
          if (i64.const(1)) continue;
          if (i64.const(2)) continue;
          if (i64.const(3)) continue;
          return;
        }
      }
    */}, function() {/*
      pipeline 0 {
        b0 {
          i0 = jump ^b0
        }
        b0 -> b1
        b1 {
          i1 = jump ^b1
        }
        b1 -> b2
        b2 {
          i2 = jump ^b2
        }
        b2 -> b3
        b3 {
          i3 = jump ^b3
        }
        b3 -> b4
        b4 {
          i4 = jump ^b4
        }
        b4 -> b5
        b5 {
          i5 = i64.const 1
          i6 = i64.bool i5
          i7 = if ^b5, i6
        }
        b5 -> b6, b7
        b6 {
          i8 = jump ^b6
        }
        b6 -> b1
        b7 {
          i9 = jump ^b7
        }
        b7 -> b8
        b8 {
          i10 = jump ^b8
        }
        b8 -> b9
        b9 {
          i11 = i64.const 2
          i12 = i64.bool i11
          i13 = if ^b9, i12
        }
        b9 -> b10, b11
        b10 {
          i14 = jump ^b10
        }
        b10 -> b2
        b11 {
          i15 = jump ^b11
        }
        b11 -> b12
        b12 {
          i16 = jump ^b12
        }
        b12 -> b13
        b13 {
          i17 = i64.const 3
          i18 = i64.bool i17
          i19 = if ^b13, i18
        }
        b13 -> b14, b15
        b14 {
          i20 = jump ^b14
        }
        b14 -> b3
        b15 {
          i21 = jump ^b15
        }
        b15 -> b16
        b16 {
          i22 = ret ^b16
        }
      }
    */});
  });
});
