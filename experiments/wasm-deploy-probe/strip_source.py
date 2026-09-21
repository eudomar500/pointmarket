#!/usr/bin/env python3
"""
Strip comments, blank lines and docstrings from a GenLayer contract source.

Deploy gas on Bradbury is dominated by calldata, and the contract source IS the
calldata, so anything the interpreter does not need is paid for at about 800 gas
per byte. This removes what is free to remove and nothing else: no renaming, no
reformatting, no semantic change.

Two things it is careful about:

  * the first line is the runner directive, `# { "Depends": ... }`. GenVM reads
    it as runner.json (ADR-002: a text contract "starting with comment (#, //,
    --), where the comment is treated as runner.json"), so it is a comment that
    must survive.
  * a function or class whose entire body is a docstring needs a `pass` put back
    in its place, or the result will not parse.

Usage:
    python3 strip_source.py <in.py> <out.py>
"""

import ast
import io
import sys
import tokenize
from pathlib import Path

SCOPES = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def docstring_lines(tree):
    """Line numbers occupied by docstrings, and the ones needing a `pass`."""
    drop = set()
    needs_pass = {}
    for node in ast.walk(tree):
        if not isinstance(node, SCOPES):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if not (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            continue
        drop.update(range(first.lineno, first.end_lineno + 1))
        if len(body) == 1 and not isinstance(node, ast.Module):
            needs_pass[first.lineno] = first.col_offset
    return drop, needs_pass


def string_spanned_lines(tree):
    """Lines covered by any multi-line string literal, including f-strings.

    This is taken from the AST rather than from tokenize on purpose. Since
    Python 3.12 an f-string is not a single STRING token but a run of
    FSTRING_START / MIDDLE / END tokens, so a tokenize-based guard silently
    misses it. Marketplace.py contains exactly such a case: a multi-line
    f-string holding the dispute prompt, with blank lines inside the literal
    that are part of the text the model is shown. Removing them as "blank
    lines" would change what the contract does.
    """
    spanned = set()
    for node in ast.walk(tree):
        is_str = (
            isinstance(node, ast.JoinedStr)
            or (isinstance(node, ast.Constant) and isinstance(node.value, str))
        )
        if not is_str:
            continue
        end = getattr(node, "end_lineno", None)
        if end is not None and end > node.lineno:
            spanned.update(range(node.lineno, end + 1))
    return spanned


def strip_comments(src, protected_extra=frozenset()):
    """Blank out COMMENT tokens, leaving every other character in place.

    Lines touched by a multi-line string are left completely alone: trailing
    whitespace inside a triple-quoted literal is part of the value, and
    trimming it would change what the contract does.
    """
    lines = src.splitlines(keepends=False)
    readline = io.StringIO(src).readline
    cuts = {}
    protected = set()
    for tok in tokenize.generate_tokens(readline):
        if tok.type == tokenize.COMMENT:
            cuts.setdefault(tok.start[0], []).append((tok.start[1], tok.end[1]))
        elif tok.type == tokenize.STRING and tok.end[0] > tok.start[0]:
            protected.update(range(tok.start[0], tok.end[0] + 1))
    protected.update(protected_extra)
    out = []
    for i, line in enumerate(lines, start=1):
        if i in protected:
            out.append(line)
            continue
        for start, end in sorted(cuts.get(i, []), reverse=True):
            line = line[:start] + line[end:]
        out.append(line.rstrip())
    return out


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src_path, dst_path = Path(sys.argv[1]), Path(sys.argv[2])
    src = src_path.read_text()

    tree = ast.parse(src)
    drop, needs_pass = docstring_lines(tree)
    original = src.splitlines(keepends=False)
    lines = strip_comments(src, string_spanned_lines(tree))
    inside_string = string_spanned_lines(tree)

    kept = []
    for number, line in enumerate(lines, start=1):
        if number == 1:
            # The runner directive, kept verbatim from the original: the comment
            # stripper has already removed it from `lines`, and without it GenVM
            # rejects the contract with `invalid_contract absent_runner_comment`.
            kept.append(original[0])
            continue
        if number in drop:
            if number in needs_pass:
                kept.append(" " * needs_pass[number] + "pass")
            continue
        if not line.strip() and number not in inside_string:
            continue
        kept.append(line)

    result = "\n".join(kept) + "\n"
    ast.parse(result)  # refuse to emit something that does not parse
    dst_path.write_text(result)

    print(f"{src_path} -> {dst_path}")
    print(f"  {len(src.encode()):,} bytes -> {len(result.encode()):,} bytes "
          f"({100.0 * len(result.encode()) / len(src.encode()):.1f}%)")
    print(f"  lines {len(lines):,} -> {len(kept):,}")
    print(f"  docstring lines removed: {len(drop):,}")


if __name__ == "__main__":
    main()
