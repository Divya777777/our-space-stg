const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileRouter } = require('../routes/mobile');
const { response } = require('./helpers');
function fixture() {
  const room = { room_id: 7, room_code: 'MOON01', room_name: 'Moon', host_user_id: 1, is_active: true,
    members: [1,2].map(user_id => ({ user_id, user: { user_id, display_name: 'Person' } })) };
  const personal = { playlist_id: 10, playlist_name: 'Private', playlist_type: 'personal', created_by_user_id: 1, room: null, is_active: true, songs: [] };
  let query; const writes = [];
  const db = { rooms: { findUnique: async () => room, findMany: async () => [room] }, room_members: { updateMany: async () => ({ count: 1 }) },
    playlists: { findUnique: async () => personal, findMany: async q => { query=q; return [personal]; } } };
  const auth = () => {};
  const router = createMobileRouter({ db, auth,
    roomService: { getPendingRequests: async () => [] },
    playlistService: { getNowPlaying: async () => ({ videoId: 'abcdefghijk', isPlaying: true, currentTimeSeconds: 2, startedAt: '2026-09-30T00:00:00Z', nowPlayingId: '8' }),
      createPlaylist: async (...args) => { writes.push(args); return { success: true, playlist: personal }; } },
    messageService: { getRoomMessages: async () => [{ messageId: '3', sender: { userId: '2', displayName: 'Friend' }, content: 'Hello', sentAt: '2026-09-30T00:00:00Z' }] }
  });
  async function invoke(path, method, { userId=1, params={}, body={}, query={} }={}) {
    const res=response(); const route=router.stack.find(l=>l.route?.path===path&&l.route.methods[method]).route;
    await route.stack.at(-1).handle({ user:{user_id:userId,display_name:'Person'},params,body,query },res); return res;
  }
  return { router, auth, invoke, writes, query:()=>query };
}
test('mobile data routes are authenticated; capability check is public',()=>{
  const f=fixture();const i=f.router.stack.findIndex(l=>l.handle===f.auth);
  assert.ok(f.router.stack.findIndex(l=>l.route?.path==='/capabilities')<i);assert.ok(i>0);
  f.router.stack.forEach((l,j)=>{if(l.route&&l.route.path!=='/capabilities')assert.ok(j>i);});
});
test('native room model includes correctly mapped messages and playback',async()=>{
  const res=await fixture().invoke('/rooms/:code','get',{params:{code:'MOON01'}});
  assert.equal(res.statusCode,200);assert.equal(res.data.hostId,'1');assert.equal(res.data.messages[0].text,'Hello');
  assert.equal(res.data.playback.revision,8);assert.equal(res.data.playback.updatedAt,Date.parse('2026-09-30T00:00:00Z'));
});
test('pending members cannot read rooms or call signals',async()=>{
  const f=fixture();for(const path of ['/rooms/:code','/rooms/:code/call']){
    const res=await f.invoke(path,'get',{userId:999,params:{code:'MOON01'}});assert.equal(res.statusCode,403);assert.match(res.data.error,/Waiting for/);
  }
});
test('non-admin cannot approve requests',async()=>{
  const res=await fixture().invoke('/rooms/:code/approve','post',{userId:2,params:{code:'MOON01'},body:{userId:'3',approved:true}});assert.equal(res.statusCode,403);
});
test('personal creation and library use authenticated owner',async()=>{
  const f=fixture();const res=await f.invoke('/playlists','post',{body:{name:'Mine',scope:'personal',ownerId:'999'}});
  assert.equal(res.statusCode,201);assert.equal(res.data.roomCode,null);assert.equal(f.writes[0][0],1);
  await f.invoke('/playlists','get');assert.equal(f.query().where.OR[0].created_by_user_id,1);
});
test('another room member cannot mutate private playlists',async()=>{
  const f=fixture();const res=await f.invoke('/playlists/:id/tracks','post',{userId:2,params:{id:'10'},body:{videoId:'abcdefghijk',title:'Song'}});
  assert.equal(res.statusCode,403);assert.equal(f.writes.length,0);
});
test('call signals go only to their approved recipient with incremental cursors',async()=>{
  const f=fixture();const params={code:'MOON01'};
  assert.equal((await f.invoke('/rooms/:code/call/signal','post',{params,body:{to:'999',type:'invite',payload:{}}})).statusCode,403);
  assert.equal((await f.invoke('/rooms/:code/call/signal','post',{params,body:{to:'2',type:'invite',payload:{video:true}}})).statusCode,200);
  assert.equal((await f.invoke('/rooms/:code/call','get',{params})).data.signals.length,0);
  const received=await f.invoke('/rooms/:code/call','get',{userId:2,params});assert.equal(received.data.signals[0].from,'1');
  assert.equal((await f.invoke('/rooms/:code/call','get',{userId:2,params,query:{after:received.data.signals[0].id}})).data.signals.length,0);
});
