// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countLines, languageFamily, parseSource, parseStatusRows, pickPeers, sourceUrl, statusUrl } from '../codePeek';

/** Trimmed from a live status page: every row carries the same eight cells. */
function statusRow(id: number, handle: string, language: string, ms: number, verdict: string, party = ';1;') {
  return `<tr data-submission-id="${id}" partyMemberIds="${party}">
  <td class="id-cell"><a class="view-source" href="/problemset/submission/2000/${id}">${id}</a></td>
  <td class="status-small"><span class="format-time">Aug/24/2024 11:20</span></td>
  <td class="status-party-cell"><a href="/profile/${handle}" class="rated-user">${handle}</a></td>
  <td class="status-small"><a href="/problemset/problem/2000/B">2000B - Seating in a Bus</a></td>
  <td> ${language} </td>
  <td class="status-cell status-verdict-cell"><span class="submissionVerdictWrapper">${verdict}</span></td>
  <td class="time-consumed-cell"> ${ms}&nbsp;ms </td>
  <td class="memory-consumed-cell"> 23400&nbsp;KB </td>
</tr>`;
}

const ACCEPTED = '<span class="verdict-accepted">Accepted</span>';

const STATUS_HTML = `<table class="status-frame-datatable">
<tr class="first-row"><th>#</th><th>When</th><th>Who</th><th>Problem</th><th>Lang</th><th>Verdict</th><th>Time</th><th>Memory</th></tr>
${statusRow(11, 'tourist', 'C++20 (GCC 13-64)', 31, ACCEPTED)}
${statusRow(12, 'team.alpha', 'C++17 (GCC 7-32)', 31, ACCEPTED, ';2;;3;')}
${statusRow(13, 'vjudge.4', 'GNU C++17', 46, ACCEPTED)}
${statusRow(14, 'Petr', 'PyPy 3-64', 62, ACCEPTED)}
${statusRow(15, 'wa.user', 'C++20 (GCC 13-64)', 15, '<span class="verdict-wrong">Wrong answer</span>')}
${statusRow(16, 'tourist', 'C++23 (GCC 14-64, msys2)', 78, ACCEPTED)}
</table>`;

const SOURCE_HTML = `<pre id="program-source-text" class="prettyprint">#include &lt;bits/stdc++.h&gt;

int main() {
    return 0;
}
</pre>`;

describe('code peek parsing', () => {
  it('keeps only accepted rows with the fields the panel shows', () => {
    const rows = parseStatusRows(STATUS_HTML);
    expect(rows.map(row => row.submissionId)).toEqual([11, 12, 13, 14, 16]);
    expect(rows[0]).toMatchObject({ handle: 'tourist', language: 'C++20 (GCC 13-64)', ms: 31, partyMembers: 1 });
    expect(rows[1].partyMembers).toBe(2);
  });

  it('reads the source text and counts only lines that carry code', () => {
    const source = parseSource(SOURCE_HTML);
    expect(source).toBe('#include <bits/stdc++.h>\n\nint main() {\n    return 0;\n}');
    expect(countLines(source)).toBe(4);
    expect(countLines('a\n\n\nb\n\n')).toBe(2);
  });

  it('drops the viewer, mirrors, team submissions and one handle duplicates', () => {
    const rows = parseStatusRows(STATUS_HTML);
    expect(pickPeers(rows, { family: 'cpp', handle: 'tourist' }).map(row => row.handle)).toEqual([]);
    expect(pickPeers(rows, { family: 'cpp', handle: 'someone' }).map(row => row.handle)).toEqual(['tourist']);
    expect(pickPeers(rows, { family: 'python', handle: 'someone' }).map(row => row.handle)).toEqual(['Petr']);
    expect(pickPeers(rows, { family: null, handle: 'petr' }).map(row => row.handle)).toEqual(['tourist']);
  });

  it('groups per-compiler language names into one family', () => {
    expect(languageFamily('C++20 (GCC 13-64)')).toBe('cpp');
    expect(languageFamily('GNU C++17')).toBe('cpp');
    expect(languageFamily('PyPy 3-64')).toBe('python');
    expect(languageFamily('Python 3')).toBe('python');
    expect(languageFamily('Rust 2021')).toBe('rust');
    expect(languageFamily('C# 10')).toBe('dotnet');
  });

  it('builds the sorted status and source URLs', () => {
    expect(statusUrl(2000, 'B', 2)).toBe('https://codeforces.com/problemset/status/2000/problem/B/page/2?order=BY_CONSUMED_TIME_ASC');
    expect(sourceUrl(2000, 11)).toBe('https://codeforces.com/problemset/submission/2000/11');
  });
});
