
// The R 4.2.0 syntax table, from ?Syntax:
//
//  ":: :::"           access variables in a namespace
//  "$ @"              component / slot extraction
//  "[ [["             indexing
//  "^"                exponentiation (right to left)
//  "- +"              unary minus and plus
//  ":"                sequence operator
//  "%any% |>"         special operators (including "%%" and "%/%")
//  "* /"              multiply, divide
//  "+ -"              (binary) add, subtract
//  "< > <= >= == !="  ordering and comparison
//  "!"                negation
//  "&  &&"            and
//  "| ||"             or
//  "~"                as in formulae
//  "-> ->>"           rightwards assignment
//  "<- <<-"           assignment (right to left)
//  "="                assignment (right to left)
//  "?"                help (unary and binary)
//
// R also has an operator precedence table defined here:
//
// https://github.com/wch/r-source/blob/36008873fb8ca2af3bdaaff418dbade5f7bce118/src/main/gram.y#L414-L436
//
// However, the effective precedence of "?" and "=" is a bit different, as R
// defines special reduction rules for these operators:
//
// https://github.com/wch/r-source/blob/36008873fb8ca2af3bdaaff418dbade5f7bce118/src/main/gram.y#L440-L453
//
// Rather than try to replicate those reduction rules, we just adjust the
// operator precedence to match the declared precedence in the R syntax table,
// while allowing for R's declared precedence differences between certain
// control flow keywords.

// Precedence table for unary operators.
const UNARY_OPERATORS = {
  unary_help: [prec.left, 1],
  unary_tilde: [prec.left, 5],
  unary_not: [prec.left, 8],
  unary_plus: [prec.left, 14],
  unary_minus: [prec.left, 14]
};

// Precedence table for binary operators.
const BINARY_OPERATORS = {
  binary_help:    [prec.left,  1],
  colon_assignment:   [prec.right, 2],
  equals_assignment:    [prec.right, 3],
  left_arrow_assignment:   [prec.right, 3],
  left_arrow_super_assignment:  [prec.right, 3],
  right_arrow_assignment:   [prec.left,  4],
  right_arrow_super_assignment:  [prec.left,  4],
  binary_tilde:    [prec.left,  5],
  pipe:   [prec.left,  6],
  pipebind:   [prec.left,  6],
  or2:   [prec.left,  7],
  or:    [prec.left,  7],
  and2:   [prec.left,  8],
  and:    [prec.left,  8],
  less_than:    [prec.left,  9],
  less_than_equal:   [prec.left,  9],
  greater_than:    [prec.left,  9],
  greater_than_equal:   [prec.left,  9],
  equal:   [prec.left,  9],
  not_equal:   [prec.left,  9],
  binary_plus:    [prec.left,  10],
  binary_minus:    [prec.left,  10],
  multiplication:    [prec.left,  11],
  division:    [prec.left,  11],
  special_gt_lt: [prec.left,  12],
  special_dollar:  [prec.left,  12],
  special_excl: [prec.left,  12],
  special_gt:  [prec.left,  12],
  special_t: [prec.left,  12],
  modulus:   [prec.left,  12],
  sequence:    [prec.left,  13],
  exponentation_star:   [prec.right, 15],
  exponentation:    [prec.right, 15],
  index:    [prec.left,  18],
  index_slot:    [prec.left,  18],
  namespace_get:   [prec.left,  20],
  namespace_get_int:  [prec.left,  20],
};

// All operators.
let OPERATORS = [...new Set([
  ...Object.keys(UNARY_OPERATORS),
  ...Object.keys(BINARY_OPERATORS)
])];

// NOTE: We only include keywords which aren't included as part of special forms.
// In other words, no keywords used in special control-flow constructions.
const KEYWORDS = [
  "return", "next", "break", "TRUE", "FALSE", "NULL", "Inf", "NaN",
  "NA", "NA_integer_", "NA_real_", "NA_complex_", "NA_character_",
];

function commaSep1($, rule) {
  return seq(rule, repeat(seq($.comma, rule)));
}

function unaryRule($, rule, spec) {
  const [assoc, prec] = spec;
  return assoc(prec, seq(field("operator", rule), field("operand", $._expression)));
}

function binaryRule($, rule, spec) {

  const [assoc, prec] = spec;

  // Special handling for '%%'.
  if (rule === "%%") {
    rule = alias(/%[^%]*%/, "%%");
  }

  const inner = (rule === "::" || rule === ":::")
    ? seq(field("lhs", $._expression), field("operator", rule), field("rhs", $._expression))
    : seq(field("lhs", $._expression), field("operator", rule), repeat($._newline), field("rhs", $._expression));

  return assoc(prec, inner);

}

function operator($, rule) {

  // Get the precedence values.
  const unarySpec  = UNARY_OPERATORS[rule];
  const binarySpec = BINARY_OPERATORS[rule];

  // Build the operator rules.
  // Note: newlines aren't permitted following a '::' or ':::'.
  if (binarySpec == null) {
    return unaryRule($, rule, unarySpec);
  } else if (unarySpec == null) {
    return binaryRule($, rule, binarySpec);
  } else {
    return choice(
      unaryRule($, rule, unarySpec),
      binaryRule($, rule, binarySpec)
    );
  }
}

function generateKeywordRules($) {
  return KEYWORDS.reduce((object, item) => {
    object[item] = $ => item;
    return object;
  }, {});
}

function keywordRules($) {
  return KEYWORDS.map((value) => $[value]);
}

function generateOperatorRules($) {
  return OPERATORS.reduce((rules, key) => {
    rules[key] = $ => operator($, key);
    return rules;
  }, {});
}

function operatorRules($) {
  return OPERATORS.map((key) => {
    return $[key];
  });
}

module.exports = grammar({

  name: "r",

  extras: $ => [
    $.comment,
    /\s/
  ],

  externals: $ => [
    $._newline,
    $._semicolon,
    $._raw_string_literal,
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    "[[",
    "]]",
  ],

  word: $ => $._identifier,

  rules: {

    // Top-level rules.
    program: $ => repeat(choice($._expression, $._semicolon, $._newline)),

    // Function definitions.
    function: $ => prec.right(seq(
      choice("\\", "function"),
      field("parameters", $.parameters),
      repeat($._newline),
      optional(field("body", $._expression))
    )),

    // NOTE: We include "(" and ")" as part of the rule here to allow
    // tree-sitter to create a "parameters" node in the AST even when
    // no parameters are declared for a function.
    parameters: $ => seq(
      "(",
      optional(commaSep1($, field("parameter", $.parameter))),
      ")"
    ),

    parameter: $ => choice(
      seq(field("name", $.identifier), "=", optional(field("default", $._expression))),
      field("name", choice($.identifier, $.dots))
    ),

    // Control flow.
    if: $ => prec.right(seq(
      "if",
      repeat($._newline),
      "(",
      field("condition", $._expression),
      ")",
      repeat($._newline),
      field("consequence", $._expression),
      repeat($._newline),
      optional(seq("else", field("alternative", $._expression)))
    )),

    for: $ => prec.right(seq(
      "for",
      repeat($._newline),
      "(",
      field("variable", $.identifier),
      "in",
      field("sequence", $._expression),
      ")",
      repeat($._newline),
      optional(field("body", $._expression))
    )),

    while: $ => prec.right(seq(
      "while",
      repeat($._newline),
      "(",
      field("condition", $._expression),
      ")",
      repeat($._newline),
      optional(field("body", $._expression))
    )),

    repeat: $ => prec.right(seq(
      "repeat",
      repeat($._newline),
      optional(field("body", $._expression))
    )),

    // Blocks.
    block: $ => prec.right(seq(
      "{",
      repeat(field("body", choice($._expression, $._semicolon, $._newline))),
      optional("}")
    )),

    block_expression: $ => prec.right(seq(
      "(",
      repeat(field("body", choice($._expression, $._newline))),
      optional(")")
    )),

    // Function calls and subsetting.
    call: $ => prec.right(16, seq($._expression, field("arguments", alias($._call_arguments,    $.arguments)))),
    subset:  $ => prec.right(16, seq($._expression, field("arguments", alias($._subset_arguments,  $.arguments)))),
    subset2: $ => prec.right(16, seq($._expression, field("arguments", alias($._subset2_arguments, $.arguments)))),

    // Dummy rule; used for aliasing so we can easily search the AST.
    arguments: $ => $._expression,

    // The actual matching rules for arguments in each of the above.
    // Semi-colons are not actually permitted here, but we add them to the rules to avoid
    // semi-colons erroneously closing a call.
    _call_arguments:    $ => prec.right(seq("(",  repeat(choice($.comma, $._semicolon, field("argument", $.argument))), optional(")"))),
    _subset_arguments:  $ => prec.right(seq("[",  repeat(choice($.comma, $._semicolon, field("argument", $.argument))), optional("]"))),
    _subset2_arguments: $ => prec.right(seq("[[", repeat(choice($.comma, $._semicolon, field("argument", $.argument))), optional("]]"))),

    // An argument; either named or unnamed.
    argument: $ => prec.right(choice(
      prec(1, seq(field("name", choice($.dots, $.identifier, $.string)), "=", optional(field("value", choice($._expression, $._newline))))),
      prec(2, field("value", choice($._expression, $._newline)))
    )),

    // Operators.
    ...generateOperatorRules(),

    // Keywords.
    ...generateKeywordRules(),

    // Miscellaneous.
    argument_reference: $ => token(/[.][.]\d+/),
    dots: $ => token("..."),

    // A general R expression.
    _expression: $ => prec.right(choice(

      // Function definitions.
      $.function,

      // Calls and subsets.
      $.call, $.subset, $.subset2,

      // Control flow.
      $.if, $.for, $.while, $.repeat, $.break, $.next,

      // Blocks.
      $.block, $.block_expression,

      // Binary operators.
      ...operatorRules($),

      // Keywords.
      ...keywordRules($),

      // Dots.
      $.dots,

      // E.g. '..1'
      $.argument_reference,

      // Literals.
      $.integer, $.float, $.complex, $.string,

      // Identifiers.
      prec.left($.identifier),

      // Unmatched closing brackets.
      $.unmatched_curly_bracket, $.unmatched_round_bracket, $.unmatched_square_bracket

    )),

    // Numeric literals.
    _hex_literal: $ => seq(/0[xX][0-9a-fA-F]+/),
    _number_literal: $ => /(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d*)?[i]?/,
    _float_literal: $ => choice($._hex_literal, $._number_literal),

    float: $ => $._float_literal,
    integer: $ => seq($._float_literal, "L"),
    complex: $ => seq($._float_literal, "i"),

    // Strings.
    string: $ => choice(
      $._raw_string_literal,
      /'((?:\\.)|[^'\\])*'/,
      /"((?:\\.)|[^"\\])*"/,
    ),

    // Identifiers.
    _identifier: $ => /[\p{XID_Start}.][\p{XID_Continue}.]*/,
    _quoted_identifier: $ => /`((?:\\.)|[^`\\])*`/,
    identifier: $ => choice(token("_"), $._identifier, $._quoted_identifier),

    // Comments.
    comment: $ => /#.*/,

    // Commas. We include these in the AST so we can figure out the
    // argument call position. This is necessary given how R tolerates
    // missing arguments in function calls.
    comma: $ => ",",

    // Check for un-matched closing brackets. This allows us to recover in
    // cases where the parse tree is temporarily incorrect, e.g. because the
    // user has removed the opening bracket associated with some closing bracket.
    unmatched_curly_bracket: $ => /\}/,
    unmatched_round_bracket: $ => /\)/,
    unmatched_square_bracket: $ => /\]/

  }

});
