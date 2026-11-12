// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { headerAnchor, profileHandle, ratingGraph, viewerHandle, preserveNativeGraph, hasAcceptedVerdictInPage } from '../dom';

describe('Codeforces page adapters', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('only recognizes an actual profile route', () => {
    expect(profileHandle('/profile/some.one-2')).toBe('some.one-2');
    expect(profileHandle('/profile/abc/blog')).toBeNull();
    expect(profileHandle('/blog/entry/profile/abc')).toBeNull();
  });
  it('does not identify a blog author or a viewed profile as the signed-in user', () => {
    document.body.innerHTML = '<div id="header"><div class="lang-chooser"><a href="/enter">Enter</a></div></div><a href="/profile/tourist">tourist</a>';
    expect(viewerHandle(document)).toBeNull();
    expect(headerAnchor(document)).not.toBeNull();
  });
  it('detects the header account only when the logout link verifies a session', () => {
    document.body.innerHTML = '<div id="header"><div class="lang-chooser"><a href="/profile/my.handle">My handle</a><a href="/logout?session=1">Logout</a></div></div><a href="/profile/tourist">tourist</a>';
    expect(viewerHandle(document)).toBe('my.handle');
  });
  it('only finds accepted verdicts inside the Codeforces page content', () => {
    document.body.innerHTML = '<div class="verdict-accepted">Accepted</div><div id="pageContent"></div>';
    expect(hasAcceptedVerdictInPage(document)).toBe(false);
    document.querySelector('#pageContent')!.innerHTML = '<table><tbody><tr><td class="status-verdict-cell">Accepted</td></tr></tbody></table>';
    expect(hasAcceptedVerdictInPage(document)).toBe(true);
  });
  it('does not use an unrelated roundbox as a graph anchor', () => {
    document.body.innerHTML = '<div id="pageContent"><div class="roundbox">Profile info</div></div>';
    expect(ratingGraph(document)).toBeNull();
    document.querySelector('.roundbox')!.innerHTML = '<div id="placeholder"></div>';
    expect(ratingGraph(document)).toBe(document.querySelector('.roundbox'));
  });
  it('keeps activity charts and the whole page outside the native rating target', () => {
    document.body.innerHTML = '<div id="pageContent"><div class="roundbox"><div id="userActivityGraph"></div></div><div id="placeholder"></div></div>';
    expect(ratingGraph(document)).toBe(document.querySelector('#placeholder'));
  });
  it('restores existing native graph display and priority without overwriting its other styles', () => {
    const graph = document.createElement('div'); graph.style.cssText = 'display:grid!important;color:red';
    const native = preserveNativeGraph(graph); native.setVisible(false);
    expect(graph.style.display).toBe('none');
    graph.style.background = 'blue'; native.restore();
    expect(graph.style.display).toBe('grid'); expect(graph.style.getPropertyPriority('display')).toBe('important');
    expect(graph.style.background).toBe('blue');
  });
});
