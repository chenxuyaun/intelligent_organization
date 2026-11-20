const BASE='http://127.0.0.1:4182';
const FOLLOWUP_TITLE='组织 PAT 生命周期策略如何分别影响个人与组织 token？';
const QUESTION='我分别给个人项目和某个 GitHub 组织的仓库使用 fine-grained PAT。个人项目能不能设为 no expiration？组织 token 默认最长多久，管理员能否改？旧 beta 阶段“必须过期”的规则现在还适用吗？';
async function request(path, options={}) {
  const response=await fetch(`${BASE}${path}`,options);
  const body=await response.json();
  if(!response.ok) throw new Error(`${response.status} ${body.error||response.statusText}`);
  return body;
}
const memory=await request('/api/memory');
const card=memory.cards.find(x=>x.id===1);
const latestReview=card?.reviews?.[0];
if(card?.status!=='published'||latestReview?.action!=='publish'||!String(latestReview.reviewer||'').trim()){
  throw new Error('K1 尚未由操作者发布并填写审核者；没有创建工单，也没有调用模型。');
}
const tickets=(await request('/api/tickets')).tickets;
if(tickets.some(t=>t.title===FOLLOWUP_TITLE)) throw new Error('后续问题已存在；为避免重复模型调用，停止运行。');
const baseline=await request('/api/tickets/2');
const baselineGroup=baseline.groups.find(g=>g.runGroup==='gmwkskaxf4b43');
if(!baselineGroup) throw new Error('找不到发布前基线运行组，停止运行。');
const created=await request('/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:FOLLOWUP_TITLE,description:QUESTION,category:'expiration',urgency:'normal',scope:'sample'})});
const view=await request(`/api/tickets/${created.ticket.id}/run`,{method:'POST'});
const group=view.groups[0];
const personal=group.runs.find(r=>r.mode==='personal');
const organization=group.runs.find(r=>r.mode==='organization');
const baselineOrg=baselineGroup.runs.find(r=>r.mode==='organization');
const answer=organization.output.draft_reply||'';
const result={
  card:{id:card.id,status:card.status,reviewer:latestReview.reviewer,reviewAction:latestReview.action},
  target:{id:created.ticket.id,title:created.ticket.title,runGroup:group.runGroup},
  baseline:{runGroup:baselineGroup.runGroup,organizationRefs:baselineOrg.context_sources.map(s=>s.ref),answer:baselineOrg.output.draft_reply},
  followup:{
    personal:{origin:personal.origin,retrieved:personal.context_sources.map(s=>s.ref),citations:personal.output.citations.map(s=>s.ref)},
    organization:{origin:organization.origin,retrieved:organization.context_sources.map(s=>s.ref),citations:organization.output.citations.map(s=>s.ref),answer,uncertainties:organization.output.uncertainties},
  },
  checks:{
    personalHasNoMemory:personal.context_sources.length===0&&personal.output.citations.length===0,
    organizationRetrievedK1:organization.context_sources.some(s=>s.ref==='K1'),
    organizationCitedK1:organization.output.citations.some(s=>s.ref==='K1'),
    says366Days:/366\s*天|366\s*日/.test(answer),
    distinguishesPersonalNoExpiry:/个人.{0,80}(无过期|no expiration|no-expiration)/i.test(answer),
    marksBetaHistorical:/2022.{0,30}(beta|公测).{0,30}(历史|旧|不适用)/i.test(answer),
  }
};
console.log(JSON.stringify(result,null,2));
