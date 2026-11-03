/* セーブしました。 - 本番データ接続 (supabase-js v2) */
(() => {
  'use strict';
  const TABLES = ['reviews', 'games', 'play_sessions'];
  const isUUID = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const newId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? n : (n & 3) | 8).toString(16); });
  let client = null;
  function init() {
    const c = window.GAME_CONFIG || {};
    if (!/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(c.supabaseUrl || '') ||
        !/^(sb_publishable_|eyJ)/.test(c.supabasePublishableKey || '')) {
      return { ready: false, message: 'Supabaseの接続先が未設定です。READMEの手順に沿って config.js を設定してください。' };
    }
    if (!window.supabase?.createClient) return { ready: false, message: 'Supabaseのライブラリを読み込めませんでした。ネットワーク接続を確認してください。' };
    client = window.supabase.createClient(c.supabaseUrl.replace(/\/$/, ''), c.supabasePublishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    return { ready: true, message: 'Supabaseに接続しました。' };
  }
  function ensure() { if (!client) throw new Error('Supabaseが未設定です。'); return client; }
  function unwrap(res) { if (res.error) throw res.error; return res.data; }
  async function list(table) {
    if (!TABLES.includes(table)) throw new Error('不明なデータ種別です。');
    const rows = []; let start = 0;
    while (true) {
      const res = await ensure().from(table).select('id,payload,created_at').order('created_at', { ascending: false }).range(start, start + 499);
      const page = unwrap(res) || [];
      rows.push(...page.map(row => ({ ...(row.payload || {}), id: row.id })));
      if (page.length < 500) break;
      start += page.length;
    }
    return rows;
  }
  async function getProfile() {
    const data = unwrap(await ensure().from('site_profile').select('payload').eq('id', 1).maybeSingle());
    return data?.payload || null;
  }
  async function loadAll() {
    const [reviews, games, playSessions, profile] = await Promise.all([
      list('reviews'), list('games'), list('play_sessions'), getProfile()
    ]);
    return { reviews, games, playSessions, profile };
  }
  async function checkAdmin() {
    const { data: authData, error: authError } = await ensure().auth.getUser();
    if (authError || !authData?.user) return false;
    const { data, error } = await ensure().from('admins').select('user_id').eq('user_id', authData.user.id).maybeSingle();
    if (error) throw error;
    return !!data;
  }
  async function login(email, password) {
    const { error } = await ensure().auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!await checkAdmin()) {
      await ensure().auth.signOut();
      throw new Error('このアカウントは管理者として登録されていません。SQLのadminsテーブルを確認してください。');
    }
    return true;
  }
  async function logout() { const { error } = await ensure().auth.signOut(); if (error) throw error; }
  async function put(table, item) {
    if (!TABLES.includes(table)) throw new Error('不明なデータ種別です。');
    if (!isUUID(item?.id)) throw new Error('データIDが正しくありません。');
    unwrap(await ensure().from(table).upsert({ id: item.id, payload: item, created_at: item.created || new Date().toISOString() }, { onConflict: 'id' }));
  }
  async function remove(table, id) {
    if (!TABLES.includes(table) || !isUUID(id)) throw new Error('削除対象IDが正しくありません。');
    unwrap(await ensure().from(table).delete().eq('id', id));
  }
  async function putProfile(profile) {
    unwrap(await ensure().from('site_profile').upsert({ id: 1, payload: profile }, { onConflict: 'id' }));
  }
  async function importBackup(input) {
    const data = input && typeof input === 'object' ? input : {};
    const oldGames = Array.isArray(data.games) ? data.games.filter(x => x && typeof x === 'object') : [];
    const oldReviews = Array.isArray(data.reviews) ? data.reviews.filter(x => x && typeof x === 'object') : [];
    const oldSessions = Array.isArray(data.playSessions) ? data.playSessions.filter(x => x && typeof x === 'object') : [];
    if (oldGames.length + oldReviews.length + oldSessions.length > 2000) throw new Error('一度に取り込める記録は2,000件までです。');
    if (!oldGames.length && !oldReviews.length && !oldSessions.length && !data.profile) throw new Error('バックアップ内に取り込み対象がありません。');
    const ids = new Map();
    const games = oldGames.map(g => {
      const id = isUUID(g.id) ? g.id : newId();
      if (g.id != null) ids.set(String(g.id), id);
      return { ...g, id };
    });
    const reviews = oldReviews.map(r => ({
      ...r, id: isUUID(r.id) ? r.id : newId(),
      gameId: r.gameId == null ? null : ids.get(String(r.gameId)) || (isUUID(r.gameId) ? r.gameId : null)
    }));
    const sessions = oldSessions.map(s => ({
      ...s, id: isUUID(s.id) ? s.id : newId(),
      gameId: ids.get(String(s.gameId)) || (isUUID(s.gameId) ? s.gameId : null)
    })).filter(s => s.gameId);
    // 失敗時に再度インポートできるよう、各レコードを独立して登録します。
    for (const g of games) await put('games', g);
    for (const r of reviews) await put('reviews', r);
    for (const s of sessions) await put('play_sessions', s);
    if (data.profile && typeof data.profile === 'object') await putProfile(data.profile);
    return { games: games.length, reviews: reviews.length, sessions: sessions.length };
  }
  window.GameCloud = Object.freeze({ init, loadAll, checkAdmin, login, logout, put, remove, putProfile, importBackup });
})();
