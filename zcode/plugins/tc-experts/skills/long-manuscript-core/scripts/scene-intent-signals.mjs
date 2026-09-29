// Bounded lexical composition, not a learned semantic model. Domain nouns alone do not route.
const rules = [
  ['academic-monograph', /学术专著|academic monograph|literature review/, [/学术|博士|课题|科研|研究成果|教学研究/, /专著|书籍|著作|出版|一本书/]],
  ['annual-chronicle', /年鉴|annual chronicle/, [/全年|这一整年|年度|每年|按月/, /大事|发展|纪事|编年|历程/]],
  ['biography-memorial', /传记|悼念|追思|老校长[^，,。；;\n]{0,28}(?:走了|怀念|册子)|biography/, [/去世|逝世|走了|故人|生平|老先生|老校长|怀念/, /纪念册|纪念文集|册子|事迹|文章|生平|片段|怀念/]],
  ['brand-story-longform', /品牌故事|品牌长文|创业故事|创始人[^，,。；;\n]{0,20}故事|白手起家|品牌[^，,。；;\n]{0,16}从[^，,。；;\n]{0,16}到|摆地摊[^，,。；;\n]{0,12}上市|蹬三轮[^，,。；;\n]{0,28}(?:分厂|打拼|经历)|brand story/, [/品牌|创始人|创业|老板|打拼|送货/, /故事|诞生|叙事|历程|长文|成长|打动|传播|推文|刷屏/]],
  ['casebook', /案例集|案例册|事例集|案例汇编|客户故事[^，,。；;\n]{0,24}(?:代表|编|一册)|客户[^，,。；;\n]{0,28}(?:事例|事迹)[^，,。；;\n]{0,28}(?:装订|成册)|casebook|项目复盘/, [/案例|典型客户|典型事例|客户服务|客户故事|项目|事例|排忧解难/, /汇编|合集|汇成|一册|整合成|装订|成册|案例分析|案例研究|研究案例|代表性|挑[^，,。；;\n]{0,8}编/]],
  ['collection-album', /画册|图集|影集|影像集|相册|成长影像|成长注脚|album/, [/照片|摄影作品|图文|成长记录|影像|女儿|孩子|宝宝/, /编排|纪念册|合集|成册|年份|出生|成长|注脚|配文|配上/]],
  ['conference-proceedings', /会议文集|论文集|圆桌[^，,。；;\n]{0,30}(?:讲者|现场|内容)[^，,。；;\n]{0,30}(?:集子|一册)|conference proceedings/, [/论坛|研讨会|峰会|大会|圆桌|活动/, /嘉宾|讲者|发言|演讲|论文|会议记录|现场内容|集子/]],
  ['consulting-decision-report', /咨询报告|决策分析|分析建议|决策建议|可行性建议|董事会[^，,。；;\n]{0,30}(?:利弊|书面意见|拿不定主意)|consulting report/, [/战略|管理层|董事会|决策|是否|要不要|利弊/, /分析|建议|建议书|书面意见|参考|咨询|可行性/]],
  ['cultural-heritage', /非遗|文化遗产|传统技艺|老手艺|手艺[^，,。；;\n]{0,24}别失传|老师傅[^，,。；;\n]{0,20}技法|cultural heritage/, [/文物|技艺|手艺|老师傅|匠人|遗产|地方文化/, /源流|技法|工序|考证|传承|失传|保护|历史|记录|现状/]],
  ['expert-book', /经验总结成书|给同行参考的书|同行参考书|经验教训[^，,。；;\n]{0,20}(?:出本书|同行|少走弯路)|(?:做了|干了|从业)[^，,。；;\n]{0,10}年[^，,。；;\n]{0,20}(?:出本书|写书)|expert book/, [/行业经验|专业|方法论|实践经验|多年经验|经验教训|从业|做了[^，,。；;\n]{0,8}年|干了[^，,。；;\n]{0,8}年|踩过的坑/, /著作|一本书|出本书|同行|书籍|成书|少走弯路|参考的书|总结/]],
  ['genealogy', /族谱|宗谱|家谱|家乘|世系|谱牒|支谱|genealogy/, [/家族|家训|家风|各房|支系/, /历史|迁徙|分支|家史|编谱|编修|续修/]],
  ['investigative-report-restricted', /内部审计报告|内部调查报告|审计调查报告|内审[^，,。；;\n]{0,32}(?:一把手|副总|过目|结论材料)|限[^，,。；;\n]{0,12}传阅|只给[^，,。；;\n]{0,12}(?:高管|管理层|副总裁)[^，,。；;\n]{0,6}(?:看|传阅)|审计部[^，,。；;\n]{0,24}书面材料|investigative report/, [/调查|举报|舞弊|调查报告|内部审计|内审|审计部|审计发现|资金往来|应收账款|问题线索/, /内部|敏感|保密|受限|深度|管理层|高管|副总裁|副总|一把手|只给|过目|传阅|书面材料|结论材料/]],
  ['memoir-oral-history', /回忆录|口述史|口述历史|讲话录音[^，,。；;\n]{0,20}(?:成书|做成书|整理)|生前[^，,。；;\n]{0,20}录音|(?:磁带|录音带)[^，,。；;\n]{0,30}(?:打出来|装订|成册)|memoir|oral history/, [/口述|访谈|采访|回忆|讲过|讲话|生前|奶奶|爷爷|外婆|祖父|祖母|长辈/, /录音|录音带|磁带|文稿|整理|老人|老员工|打出来|装订|一个字一个字|成书|成册|做成书/]],
  ['operation-manual', /操作手册|作业流程手册|使用手册|用户手册|维修手册|维护手册|排障手册|速查卡|故障处置指引|本土化[^，,。；;\n]{0,12}(?:手册|指引)|机床[^，,。；;\n]{0,20}(?:怎么用|怎么查)|standard operating procedure|operation manual/, [/设备|机器|机床|装备|车间|生产线|操作|作业流程|日常保养/, /说明书|使用说明|手册|速查|指引|本土化|册子|步骤|说明|故障处置|故障排查|怎么用|怎么查|排障/]],
  ['organization-history', /organization history|企业史|公司史|厂史|校史|院史|村史|行史|(?:建院|建校|建厂)[^，,。；;\n]{0,12}周年/, [/公司|企业|集团|单位|机构|社团|组织|厂子|工厂|学校|医院|院领导|村庄/, /成立|建院|建校|周年|沿革|发展史|历程|历史|回顾册|回顾|风雨/]],
  ['policy-standard-guide', /条文解读|新规解读|政策解读|法规解读|逐条讲解|基层[^，,。；;\n]{0,16}(?:解读|讲解)|policy guide/, [/政策|法规|行业标准|规范标准|新规|条例|条文|监管总局|监管所/, /指南|解读|讲解|逐条|看得懂|编制说明|说明书|面向基层/]],
  ['proposal-rfp', /投标|招标|标书|响应文件|\brfp\b|招标响应|proposal rfp/, [/客户|甲方|项目|标书/, /方案建议书|响应要求|响应文件|交上去|投标/]],
  ['technical-documentation', /技术文档|开发者参考手册|开发文档|开放平台[^，,。；;\n]{0,30}(?:接口|资料)|sdk[^，,。；;\n]{0,18}(?:手册|文档)|technical documentation/, [/api|sdk|架构|接口|系统设计|软件系统|开发者|开放平台|接入方/, /参考手册|说明|文档|资料|设计|规范|配套|重写|发布|讲清楚/]],
  ['training-course', /培训教材|内训教材|教学材料|培训手册|帮工[^，,。；;\n]{0,30}教案|带教手册|新人指南|入门读物|岗前读物|课件装订|training course/, [/培训|内训|实习生|新人|学员|新员工|带教|帮工|课程|系列课件|讲课|教师|师傅/, /教材|教学材料|教案|入门读物|讲义|用书|系统化|装订|一套|讲义内容|整理成一本书|传下去/]],
  ['whitepaper-research', /白皮书|蓝皮书|行业研究报告|正式研究报告|研究机构[^，,。；;\n]{0,16}(?:发布|报告)|实验室[^，,。；;\n]{0,16}(?:发布|报告)|whitepaper/, [/行业|协会|实验室|研究机构|智库|课题组|数据|研究/, /对外发布|正式报告|权威|可信|深度研究报告|研究报告|白皮书|蓝皮书|数据详实/]],
];
export function normalizeIntent(text) {
  return text.normalize('NFKC').toLowerCase().replace(/保護/g,'保护').replace(/學術/g,'学术').replace(/學/g,'学').replace(/歷史/g,'历史').replace(/族譜/g,'族谱').replace(/回憶錄/g,'回忆录').replace(/\s+/g,' ').trim();
}
export function scoreIntent(text) {
  const normalized = normalizeIntent(text);
  const positive = normalized.replace(/(?:不要|不需要|无需|不是)[^，,。；;\n]*(?:[，,。；;\n]|$)/g,(clause,offset,whole)=>whole[offset-1]==='要'?clause:' ');
  const shortTask = /(?:一封|一条).{0,8}(?:邮件|短信|通知)|采购询价|一句话|(?:一句|一条).{0,6}(?:广告语|口号|文案)|压缩成.{0,4}一句|朋友圈|社交媒体短文|天气|翻译.{0,8}(?:句|标题)|(?:查|查询).{0,12}(?:售价|价格|报价)|解释.{0,8}什么是/.test(positive);
  if (shortTask) return {normalized:positive,shortTask:true,scores:[]};
  const scores = rules.map(([sceneId,strong,facets])=>{
    const strongHit = strong.test(positive);
    const matchedFacets = facets.map((facet,i)=>facet.test(positive)?i:null).filter(i=>i!==null);
    let score = strongHit ? 0.94 : matchedFacets.length===facets.length ? 0.86 : matchedFacets.length ? 0.35 : 0;
    if (sceneId==='organization-history' && /全年|这一整年|年度|按月/.test(positive)) score=0;
    if (sceneId==='brand-story-longform' && /客户故事|客户服务|典型客户|事例|案例|排忧解难/.test(positive)) score=0;
    if (sceneId==='collection-album' && /去世|悼念|追思|生平/.test(positive)) score=0;
    if (sceneId==='collection-album' && /医院|学校|工厂|厂子|单位|机构/.test(positive) && /周年|建院|建校|建厂/.test(positive)) score=Math.min(score,0.35);
    if (sceneId==='memoir-oral-history' && /论坛|峰会|研讨会/.test(positive) && !/回忆录|口述史/.test(positive)) score=0;
    if (sceneId==='memoir-oral-history' && /家族|家谱|族谱|世系/.test(positive) && !strongHit) score=Math.min(score,0.7);
    if (sceneId==='expert-book' && /学术|博士|科研/.test(positive)) score=0;
    return {sceneId,score,evidence:{strong:strongHit,matchedFacets}};
  }).filter(r=>r.score>0);
  return {normalized:positive,shortTask:false,scores};
}
