#!/usr/bin/env python3
"""
Remove same-selector dead CSS property declarations from style_v2.css.

Only removes Pattern 1 (same selector, same property, later one wins).
Does NOT touch cross-selector or shorthand-overrides-longhand entries.

Safety:
  - Backs up to style_v2.css.bak first
  - Removes individual property lines (not whole blocks) unless ALL props are dead
  - Preserves formatting, comments, blank lines
  - Cleans up empty rule blocks after removal
  - Collapses 3+ consecutive blank lines to 2
"""

import re
import shutil
from collections import defaultdict
from pathlib import Path

CSS_FILE = "/Users/bosskung/Document/Money Tracker/style_v2.css"
BAK_FILE = CSS_FILE + ".bak"


# ─── Reuse the parser from find_dead_css.py ────────────────────────────────

def remove_css_comments(text):
    result = []
    i = 0
    while i < len(text):
        if text[i:i+2] == '/*':
            end = text.find('*/', i + 2)
            if end == -1:
                comment = text[i:]
                result.append(re.sub(r'[^\n]', ' ', comment))
                break
            comment = text[i:end + 2]
            result.append(re.sub(r'[^\n]', ' ', comment))
            i = end + 2
        else:
            result.append(text[i])
            i += 1
    return ''.join(result)


def compute_specificity(selector):
    sel = selector.strip()
    sel = re.sub(r'"[^"]*"', '', sel)
    sel = re.sub(r"'[^']*'", '', sel)
    ids = len(re.findall(r'#[a-zA-Z_-][a-zA-Z0-9_-]*', sel))
    sel2 = re.sub(r'#[a-zA-Z_-][a-zA-Z0-9_-]*', '', sel)
    attrs = len(re.findall(r'\[[^\]]*\]', sel2))
    sel2 = re.sub(r'\[[^\]]*\]', '', sel2)
    classes = len(re.findall(r'\.[a-zA-Z_-][a-zA-Z0-9_-]*', sel2))
    sel2 = re.sub(r'\.[a-zA-Z_-][a-zA-Z0-9_-]*', '', sel2)
    pseudo_classes = len(re.findall(r'(?<!:):[a-zA-Z_-][a-zA-Z0-9_-]*(?:\([^)]*\))?', sel2))
    sel2 = re.sub(r'(?<!:):[a-zA-Z_-][a-zA-Z0-9_-]*(?:\([^)]*\))?', '', sel2)
    pseudo_elements = len(re.findall(r'::[a-zA-Z_-]+', sel2))
    sel2 = re.sub(r'::[a-zA-Z_-]+', '', sel2)
    types = len(re.findall(r'\b[a-zA-Z][a-zA-Z0-9-]*\b', sel2))
    b = classes + attrs + pseudo_classes
    c = types + pseudo_elements
    return (ids, b, c)


def is_skip_selector(selector):
    sel = selector.strip()
    skip_patterns = [
        r'^@keyframes\b', r'^@font-face\b', r'^:root\b', r'^html\.dark\b',
        r'^@media\b', r'^@supports\b', r'^@charset\b', r'^@import\b', r'^@layer\b',
    ]
    for pat in skip_patterns:
        if re.match(pat, sel, re.IGNORECASE):
            return True
    return False


def tokenize_css(content):
    n = len(content)
    pos = 0
    line = 1
    depth = 0
    selector_buf = []
    selector_start_line = 1
    in_string = False
    string_char = None
    in_paren = 0
    decl_buf = []
    decl_start_line = 1
    current_skip = [False]
    tokens = []

    while pos < n:
        ch = content[pos]

        if ch == '\n':
            line += 1
            pos += 1
            if depth == 0:
                selector_buf.append('\n')
            else:
                decl_buf.append('\n')
            continue

        if in_string:
            if ch == string_char and (pos == 0 or content[pos-1] != '\\'):
                in_string = False
            if depth > 0:
                decl_buf.append(ch)
            else:
                selector_buf.append(ch)
            pos += 1
            continue

        if ch in ('"', "'"):
            in_string = True
            string_char = ch
            if depth > 0:
                decl_buf.append(ch)
            else:
                selector_buf.append(ch)
            pos += 1
            continue

        if depth > 0:
            if ch == '(':
                in_paren += 1
                decl_buf.append(ch)
                pos += 1
                continue
            if ch == ')' and in_paren > 0:
                in_paren -= 1
                decl_buf.append(ch)
                pos += 1
                continue

        if ch == '{' and in_paren == 0:
            if depth == 0:
                sel = ''.join(selector_buf).strip()
                selector_buf = []
                sel_line = selector_start_line
                selector_start_line = line + 1
                skip = is_skip_selector(sel)
                parent_skip = current_skip[-1] if current_skip else False
                effective_skip = skip or parent_skip
                current_skip.append(effective_skip)
                depth += 1
                if not effective_skip:
                    parts = [s.strip() for s in sel.split(',') if s.strip()]
                    for part in parts:
                        tokens.append(('OPEN', part, sel_line))
                else:
                    tokens.append(('OPEN_SKIP', sel, sel_line))
                decl_buf = []
                decl_start_line = line + 1
            else:
                sel = ''.join(decl_buf).strip()
                decl_buf = []
                skip = is_skip_selector(sel) or current_skip[-1]
                current_skip.append(skip)
                depth += 1
                if not skip:
                    parts = [s.strip() for s in sel.split(',') if s.strip()]
                    for part in parts:
                        tokens.append(('OPEN', part, line))
                else:
                    tokens.append(('OPEN_SKIP', sel, line))
            pos += 1
            continue

        if ch == '}' and in_paren == 0:
            if depth > 0:
                decl_text = ''.join(decl_buf).strip()
                decl_buf = []
                if decl_text and ':' in decl_text and not current_skip[-1]:
                    colon = decl_text.index(':')
                    prop = decl_text[:colon].strip().lower()
                    val = decl_text[colon+1:].strip()
                    if re.match(r'^-?-?[a-zA-Z][a-zA-Z0-9_-]*$', prop) and not prop.startswith('--'):
                        imp = '!important' in val.lower()
                        if imp:
                            val = re.sub(r'\s*!important\s*', '', val, flags=re.IGNORECASE).strip()
                        tokens.append(('DECL', prop, val, imp, decl_start_line))
                if not current_skip[-1]:
                    tokens.append(('CLOSE', line))
                else:
                    tokens.append(('CLOSE_SKIP', line))
                current_skip.pop()
                depth -= 1
                selector_start_line = line + 1
            pos += 1
            continue

        if ch == ';' and depth > 0:
            decl_text = ''.join(decl_buf).strip()
            decl_buf = []
            next_start = line
            if decl_text and ':' in decl_text and not current_skip[-1]:
                colon = decl_text.index(':')
                prop = decl_text[:colon].strip().lower()
                val = decl_text[colon+1:].strip()
                val = re.sub(r'\s+', ' ', val).strip()
                if re.match(r'^-?-?[a-zA-Z][a-zA-Z0-9_-]*$', prop) and not prop.startswith('--'):
                    imp = '!important' in val.lower()
                    if imp:
                        val = re.sub(r'\s*!important\s*', '', val, flags=re.IGNORECASE).strip()
                    tokens.append(('DECL', prop, val, imp, decl_start_line))
            decl_start_line = next_start + 1
            pos += 1
            continue

        if depth == 0:
            selector_buf.append(ch)
        else:
            if not decl_buf:
                decl_start_line = line
            decl_buf.append(ch)
        pos += 1

    return tokens


def parse_css(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        raw = f.read()
    content = remove_css_comments(raw)
    tokens = tokenize_css(content)
    declarations = []
    open_selectors = []
    for tok in tokens:
        kind = tok[0]
        if kind == 'OPEN':
            _, sel, sel_line = tok
            open_selectors.append((sel, sel_line))
        elif kind == 'CLOSE':
            if open_selectors:
                open_selectors.pop()
        elif kind in ('OPEN_SKIP', 'CLOSE_SKIP'):
            pass
        elif kind == 'DECL':
            _, prop, val, imp, decl_line = tok
            if open_selectors:
                selector, rule_start = open_selectors[-1]
                declarations.append({
                    'selector': selector,
                    'property': prop,
                    'value': val,
                    'important': imp,
                    'line': decl_line,
                    'rule_start': rule_start,
                    'specificity': compute_specificity(selector),
                })
    return declarations


def wins_over(d2, d1):
    if d2['important'] and not d1['important']:
        return True
    if d1['important'] and not d2['important']:
        return False
    return d2['specificity'] >= d1['specificity']


def find_same_selector_dead(declarations):
    """
    Find ONLY same-selector overrides (Pattern 1).
    Returns set of line numbers that are dead.
    Also returns list of (dead_decl, winning_decl) for audit report.
    """
    dead_lines = set()
    audit = []
    seen_dead = set()

    by_selector = defaultdict(list)
    for d in declarations:
        by_selector[d['selector']].append(d)

    for selector, decl_list in by_selector.items():
        by_prop = defaultdict(list)
        for d in decl_list:
            by_prop[d['property']].append(d)

        for prop, prop_decls in by_prop.items():
            for i, d in enumerate(prop_decls):
                key = (d['selector'], d['property'], d['line'])
                if key in seen_dead:
                    continue
                for d2 in prop_decls[i + 1:]:
                    if wins_over(d2, d):
                        dead_lines.add(d['line'])
                        audit.append((d, d2))
                        seen_dead.add(key)
                        break

    return dead_lines, audit


# ─── CSS text-level removal ────────────────────────────────────────────────

def find_declaration_line_numbers(raw_lines, dead_line_numbers):
    """
    Given 1-based dead line numbers from the parser, find the actual
    line index (0-based) in raw_lines to remove.

    The parser's 'line' for a DECL token is the line where the property name starts.
    We need to match the property line and potentially extend to multi-line values.
    """
    # Build a map: for each dead line number, find the range of lines to remove
    # Strategy: at the reported line, find the property declaration that starts there.
    # A declaration ends at the semicolon (possibly on a later line).

    lines_to_remove = set()  # 0-based line indices

    for dead_line in dead_line_numbers:
        idx = dead_line - 1  # convert to 0-based
        if idx < 0 or idx >= len(raw_lines):
            continue

        line = raw_lines[idx]

        # Check if this line contains a CSS property declaration
        # It should have "property:" pattern
        stripped = line.strip()

        # Skip if it's a comment or empty
        if not stripped or stripped.startswith('/*') or stripped.startswith('//'):
            continue

        # Check if the declaration spans multiple lines (no semicolon on this line)
        # We need to find the end of this declaration
        start_idx = idx

        # Find end of declaration (where semicolon is, or end of property before })
        end_idx = idx
        combined = line

        # Look for semicolon — if not on this line, look forward
        if ';' not in line:
            j = idx + 1
            while j < len(raw_lines):
                combined += raw_lines[j]
                end_idx = j
                if ';' in raw_lines[j] or '}' in raw_lines[j]:
                    # If we hit }, the semicolon-less declaration ends just before
                    if '}' in raw_lines[j] and ';' not in raw_lines[j]:
                        # Don't include the } line
                        end_idx = j - 1
                    break
                j += 1

        for i in range(start_idx, end_idx + 1):
            lines_to_remove.add(i)

    return lines_to_remove


def remove_dead_lines(raw_lines, lines_to_remove):
    """Remove dead declaration lines. Return new lines list."""
    result = []
    for i, line in enumerate(raw_lines):
        if i not in lines_to_remove:
            result.append(line)
    return result


def remove_empty_blocks(lines):
    """
    Remove empty CSS rule blocks: selector { } or selector {\n  \n}
    Also handles single-line: .foo { }
    """
    text = ''.join(lines)

    # Remove blocks where the content between { } is only whitespace
    # Pattern: anything followed by { whitespace-only }
    # Be careful not to match @media { ... } etc.

    changed = True
    while changed:
        changed = False
        # Multi-line empty blocks: selector {\n  \n}
        new_text = re.sub(
            r'([^{}@/][^{}]*?)\{\s*\}',
            lambda m: '' if not re.search(r'@|\*/', m.group(0)) else m.group(0),
            text,
            flags=re.MULTILINE
        )
        if new_text != text:
            text = new_text
            changed = True

    return text.splitlines(keepends=True)


def collapse_blank_lines(lines):
    """Collapse 3+ consecutive blank lines to 2."""
    result = []
    blank_count = 0
    for line in lines:
        if line.strip() == '':
            blank_count += 1
            if blank_count <= 2:
                result.append(line)
        else:
            blank_count = 0
            result.append(line)
    return result


def is_selector_line(line):
    """Heuristic: is this line a CSS selector (not a declaration, comment, or brace)?"""
    s = line.strip()
    if not s:
        return False
    if s.startswith('/*') or s.startswith('//') or s.startswith('*'):
        return False
    if s == '{' or s == '}':
        return False
    if ':' in s and not s.endswith('{') and not s.endswith(','):
        # Could be a declaration on its own line — not a selector
        # Unless it's a pseudo-class selector like :hover {
        if re.match(r'^[a-zA-Z_#.\[*:>+~-].*\{', s):
            return True
        return False
    return True


def remove_empty_blocks_careful(lines):
    """
    More careful empty block removal:
    Find consecutive lines forming: <selector line(s)> { <only whitespace lines> }
    and remove them entirely.
    """
    # Join into text, apply regex, split back
    text = ''.join(lines)

    # Remove single-line empty blocks: .foo { } or .foo {}
    # Make sure the selector part doesn't start with @ (at-rules handled separately)
    text = re.sub(
        r'^([^@{}\n][^\n{]*)\{\s*\}\s*\n?',
        '',
        text,
        flags=re.MULTILINE
    )

    # Remove multi-line empty blocks:
    # .selector {\n\n} or .selector {\n  \n  \n}
    text = re.sub(
        r'^([^@{}\n][^\n{]*)\{\s*\n\s*\}\s*\n?',
        '',
        text,
        flags=re.MULTILINE
    )

    return text.splitlines(keepends=True)


# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    css_path = Path(CSS_FILE)
    bak_path = Path(BAK_FILE)

    print(f"Reading {CSS_FILE}...")
    raw = css_path.read_text(encoding='utf-8')
    raw_lines = raw.splitlines(keepends=True)
    original_line_count = len(raw_lines)
    print(f"Original file: {original_line_count} lines")

    # Step 1: Backup
    print(f"\nBacking up to {BAK_FILE}...")
    shutil.copy2(CSS_FILE, BAK_FILE)
    print("Backup created.")

    # Step 2: Parse and find same-selector dead declarations
    print("\nParsing CSS and finding same-selector dead declarations...")
    declarations = parse_css(CSS_FILE)
    print(f"Found {len(declarations)} declarations total.")

    dead_lines, audit = find_same_selector_dead(declarations)
    print(f"Found {len(dead_lines)} same-selector dead declaration lines to remove.")

    # Step 3: Print audit report
    print("\n" + "=" * 70)
    print("AUDIT: Lines being removed")
    print("=" * 70)
    for d, d2 in sorted(audit, key=lambda x: x[0]['line']):
        imp  = " !important" if d['important']  else ""
        imp2 = " !important" if d2['important'] else ""
        val  = d['value'][:50]  + ("..." if len(d['value'])  > 50 else "")
        val2 = d2['value'][:50] + ("..." if len(d2['value']) > 50 else "")
        print(f"  REMOVE line {d['line']:4d}: [{d['selector']}] {d['property']}: {val}{imp}")
        print(f"    KEPT   line {d2['line']:4d}: [{d2['selector']}] {d2['property']}: {val2}{imp2}")
    print("=" * 70)
    print(f"Total to remove: {len(audit)}")

    # Step 4: Find actual line ranges to remove (handles multi-line decls)
    print("\nFinding exact line ranges to remove...")
    lines_to_remove = find_declaration_line_numbers(raw_lines, dead_lines)
    print(f"Total individual lines to remove: {len(lines_to_remove)}")

    # Show which raw lines are being removed
    print("\nRaw lines being removed:")
    for i in sorted(lines_to_remove):
        print(f"  Line {i+1:4d}: {raw_lines[i].rstrip()}")

    # Step 5: Remove the lines
    print("\nRemoving dead declaration lines...")
    new_lines = remove_dead_lines(raw_lines, lines_to_remove)
    print(f"After removal: {len(new_lines)} lines (removed {original_line_count - len(new_lines)} lines)")

    # Step 6: Remove empty rule blocks
    print("\nRemoving empty rule blocks...")
    new_lines = remove_empty_blocks_careful(new_lines)
    print(f"After empty block removal: {len(new_lines)} lines")

    # Step 7: Collapse excessive blank lines
    print("\nCollapsing excessive blank lines...")
    new_lines = collapse_blank_lines(new_lines)
    final_line_count = len(new_lines)
    print(f"After blank line collapse: {final_line_count} lines")
    print(f"Net reduction: {original_line_count - final_line_count} lines")

    # Step 8: Write the modified file
    print(f"\nWriting modified file to {CSS_FILE}...")
    css_path.write_text(''.join(new_lines), encoding='utf-8')
    print("File written.")

    # Step 9: Verify — re-run dead declaration finder
    print("\n" + "=" * 70)
    print("VERIFICATION: Re-running dead declaration analysis...")
    print("=" * 70)

    declarations_after = parse_css(CSS_FILE)
    dead_after, audit_after = find_same_selector_dead(declarations_after)

    print(f"Declarations before: {len(declarations)}")
    print(f"Declarations after:  {len(declarations_after)}")
    print(f"Same-selector dead before: {len(audit)}")
    print(f"Same-selector dead after:  {len(dead_after)}")

    if dead_after:
        print("\nRemaining same-selector dead declarations:")
        for d, d2 in sorted(audit_after, key=lambda x: x[0]['line']):
            print(f"  Line {d['line']:4d}: [{d['selector']}] {d['property']}: {d['value']}")
            print(f"    Still overridden by line {d2['line']}: {d2['value']}")
    else:
        print("\nAll same-selector dead declarations successfully removed!")

    print(f"\nSummary:")
    print(f"  Original lines:       {original_line_count}")
    print(f"  Final lines:          {final_line_count}")
    print(f"  Lines removed:        {original_line_count - final_line_count}")
    print(f"  Dead props removed:   {len(audit)}")
    print(f"  Dead props remaining: {len(dead_after)}")


if __name__ == '__main__':
    main()
