// ============================================================================
// 《余烬深渊》(pixel-idle-dungeon) · js/narrative.js —— 世界观文案库
//
// 全部叙事文本的唯一数据源：开场诗 / Boss 台词 / 奇遇事件 / 遗物风味小字 /
// 里程碑编年史。只导出数据、不含逻辑；下游（事件、遗物、编年史渲染）从这里
// 取文案，不在自己的文件里硬编码句子。
//
// 风格基调：太阳熄灭后第 700 年 · 初火远征 · 克制而有余韵。
// 同伴设定（与 skills.js / sprites.js 一致）：
//   秘法使·薇拉 vera——法术爆发+灼烧，精于计算；
//   圣愈者·艾琳 irene——治疗+护盾+净化，寡言而坚定；
//   影刃·凯 kai——连击+流血+斩杀，火性子的游侠。
//
// 奇遇事件 effect.type 契约（下游按此实现，勿漂移）：
//   goldGain            获得金币        value: 数值
//   goldLoss            损失金币        value: 数值
//   freeItem            直接获得装备    value: 说明串（来源/品质由下游落实）
//   trapDamage          受到陷阱伤害    value: 说明串（伤害比例由下游落实）
//   healFull            治疗至满血      value 恒为 1
//   buffAtk             主勇者攻击增益  value: 比例（0.15 = +15%）
//   buffAll             全队增益        value: 比例（0.1  = +10%）
//   relicRoll           掷一次随机遗物  value: 说明串
//   curseUntilPrestige  本轮诅咒        value: 说明串
//   floorSkip           直接跳层        value: 数值（1 = 进入下一层）
//   bossRush            直迎 Boss 战    value: 说明串
// ============================================================================

// 开场短诗（3 句，新档首次进入时逐句浮现）
export const INTRO_LINES = [
  "太阳熄灭后的第七百年，黑暗成了唯一的国。",
  "初火远征的火把一支支沉入深渊——递到你手里时，还温着。",
  "走下去。灰烬记得每一个不肯熄灭的名字。",
];

// Boss 出场台词（各 1-2 句）
export const BOSS_LINES = {
  goblinKing:
    "「我的！下面的每一枚铜板都是王的！」哥布林王抱紧钱袋，王冠歪在油腻的额前。「想过去？先上贡——用金币，或者用你们的骨头，王不挑。」",
  boneLord:
    "「又一支远征，葬在我脚下。」骸骨领主的声音像雪落进棺木。「把灯留下，或者把命留下——它们最后都归于寂静。」",
  golem:
    "「炉火冷了七百年……为什么，还要点亮什么。」魔像转动龟裂的躯体，石音里满是倦意。「为什么不睡。」",
  dragon:
    "「连太阳都死了，虫子。」暗影幼龙展开翼膜，嗤笑着俯瞰你们。「抱着那点火苗取暖的样子……勉强算有趣。烧个够吧。」",
};

// 奇遇事件（14 个）。text 两句氛围；choices 2-3 个，risk ∈ 低/中/高。
export const EVENTS = [
  {
    id: "bloodAltar",
    name: "染血的圣坛",
    text: "石坛上的血迹七百年未干，缝隙里透出微弱的暖意。很久以前，有人用最后一滴血点亮过它。",
    choices: [
      { label: "按手于血", desc: "把伤痛献进坛里，换一份灼热的力气。", risk: "中", effect: { type: "buffAtk", value: 0.25 } },
      { label: "取走祭品", desc: "坛边散落着前人留下的钱袋，捡起来不问来路。", risk: "中", effect: { type: "goldGain", value: 150 } },
      { label: "默祷片刻", desc: "向无名者的火低头。起身时，疲惫一扫而空。", risk: "低", effect: { type: "healFull", value: 1 } },
    ],
  },
  {
    id: "goblinMerchant",
    name: "发抖的哥布林商人",
    text: "一个哥布林缩在墙角，怀里死死抱着半箱货，牙齿咯咯打颤。它看见你的火把，忽然挤出一个讨好的笑。",
    choices: [
      { label: "买下它的货", desc: "它抖着手递来一件货真价实的装备，不敢要高价。", risk: "低", effect: { type: "freeItem", value: "哥布林货箱：随机一件装备" } },
      { label: "举火吓退它", desc: "火光一晃，它连滚带爬地跑了，沿途掉了一路的钱。", risk: "低", effect: { type: "goldGain", value: 80 } },
      { label: "抢走货箱", desc: "它不敢还手。但深渊看着呢——这笔债要背到轮回尽头。", risk: "高", effect: { type: "curseUntilPrestige", value: "哥布林的怨恨：本次轮回如影随形" } },
    ],
  },
  {
    id: "sealedRack",
    name: "被封印的武器架",
    text: "武器架上插着一柄缠满锁链的兵器，铭文早已磨平。锁链上落着七百年的灰，唯独握把处是亮的。",
    choices: [
      { label: "扯断锁链", desc: "封印应声崩裂——兵器直接入手，但崩飞的断链会伤人。", risk: "中", effect: { type: "freeItem", value: "封印兵器：随机一件史诗装备" } },
      { label: "辨认铭文", desc: "看清了残存的刻痕，那是远征军一路打下来的战诀。", risk: "低", effect: { type: "buffAtk", value: 0.1 } },
      { label: "取走散落的旧币", desc: "架脚处有一小袋前人没来得及带走的盘缠。", risk: "低", effect: { type: "goldGain", value: 40 } },
    ],
  },
  {
    id: "greedyMimic",
    name: "贪婪宝箱怪",
    text: "宝箱在幽暗里起伏喘息，锁孔后露出一线白牙。它是真的宝箱，也是真的饿。",
    choices: [
      { label: "撬开箱口", desc: "赌你的手快过它的牙——赌输了，就得挨一口。", risk: "高", effect: { type: "trapDamage", value: "被咬中：损失当前生命 25%" } },
      { label: "丢给它一袋金币", desc: "吞饱的宝箱怪昏昏睡去，箱口敞着剩下的半箱。", risk: "中", effect: { type: "goldGain", value: 100 } },
      { label: "捡走漏下的零钱", desc: "只拿它打盹时漏出来的几枚，不惊醒它。", risk: "低", effect: { type: "goldGain", value: 30 } },
    ],
  },
  {
    id: "namelessTomb",
    name: "无名英雄之墓",
    text: "无字碑立在苔石之间，碑前供着一盏早已燃尽的提灯。他的名字，和初火远征一起被深渊收走了。",
    choices: [
      { label: "点亮提灯", desc: "替他续一次火。灯亮的那一刻，像有旧的意志认出了你。", risk: "低", effect: { type: "buffAll", value: 0.1 } },
      { label: "取出陪葬品", desc: "死者大概不会介意——大概。", risk: "中", effect: { type: "goldGain", value: 200 } },
      { label: "诵念远征誓词", desc: "碑石深处传来一声回响，有物自灰中递出。", risk: "中", effect: { type: "relicRoll", value: "墓中传承：随机一件遗物" } },
    ],
  },
  {
    id: "lostCaravan",
    name: "迷路的商队",
    text: "几辆骡车陷在灰泥里，商人们围着一盏将熄的灯发愁。他们说要去地面——可地面在七百年前就没有太阳了。",
    choices: [
      { label: "护送一程", desc: "护他们到岔口，谢礼丰厚——但护送的路上不太平。", risk: "中", effect: { type: "freeItem", value: "商队谢礼：随机一件装备" } },
      { label: "买下他们的地图", desc: "花 100 金币买一张手绘路线图——至少今晚不会再迷路。", risk: "低", effect: { type: "goldLoss", value: 100 } },
      { label: "趁乱顺走货箱", desc: "没人看顾的那几箱最沉。深渊看在眼里。", risk: "高", effect: { type: "goldGain", value: 250 } },
    ],
  },
  {
    id: "trapCorridor",
    name: "陷阱走廊",
    text: "两侧墙壁密布锈蚀的孔洞，砖缝里卡着森白的骨刺。前人的白骨一路排到黑暗尽头，姿势都还保持着奔跑。",
    choices: [
      { label: "硬闯过去", desc: "凭甲胄硬吃一轮机关——疼，但快。", risk: "高", effect: { type: "trapDamage", value: "机关齐射：损失当前生命 30%" } },
      { label: "贴壁缓行", desc: "沿着前人踏出的那条生路，一步一顿地挪。尽头有个没被拿走的行囊。", risk: "低", effect: { type: "goldGain", value: 60 } },
    ],
  },
  {
    id: "mysteryPriest",
    name: "神秘祭司",
    text: "蒙面祭司立在残墙下，手中的烛火七百年不摇不晃。他开口，声音分不出男女：「初火记得每一次献祭。」",
    choices: [
      { label: "献上金币", desc: "把一把金币投进烛火。火光为你亮了一亮。", risk: "低", effect: { type: "buffAtk", value: 0.15 } },
      { label: "献上鲜血", desc: "割掌滴血入烛。整支队伍都沾了火光。", risk: "中", effect: { type: "buffAll", value: 0.2 } },
      { label: "追问他的名字", desc: "他笑了：「那你，替我背着它走吧。」", risk: "高", effect: { type: "curseUntilPrestige", value: "无名者的名字：本次轮回无法摆脱" } },
    ],
  },
  {
    id: "dungeonRift",
    name: "地牢裂缝",
    text: "墙面裂开一道漆黑的缝，里面没有风，却有声音。像是很深的地方，有什么东西在均匀地呼吸。",
    choices: [
      { label: "钻进裂缝", desc: "石缝向下急坠，落脚处深浅难测——运气好，一步跨过一整层。", risk: "高", effect: { type: "floorSkip", value: 1 } },
      { label: "投掷火把照明", desc: "火光惊出了缝里的东西，也照亮了它藏钱的角落。", risk: "中", effect: { type: "goldGain", value: 180 } },
      { label: "用碎石封住", desc: "不听，不看。确认再无声响之后，你睡了个安稳觉。", risk: "低", effect: { type: "healFull", value: 1 } },
    ],
  },
  {
    id: "luckyFountain",
    name: "幸运喷泉",
    text: "泉水在无光的深渊里自己发着微光，水面浮着几枚许过愿的硬币。据说喝过的人都活着走了下去——大多如此。",
    choices: [
      { label: "饮下泉水", desc: "清冽入喉，一路的伤一并合上。", risk: "低", effect: { type: "healFull", value: 1 } },
      { label: "捞取硬币", desc: "许愿的主人多半用不上它们了。", risk: "中", effect: { type: "goldGain", value: 130 } },
      { label: "沐浴泉水", desc: "赐福漫过全身，连甲缝里的疲惫都洗掉了。", risk: "低", effect: { type: "buffAll", value: 0.15 } },
    ],
  },
  {
    id: "tatteredBanner",
    name: "残破的旗帜",
    text: "前火远征的军旗挂在断柱上，只剩半幅焦边。旗面上的纹章仍可辨认：一只爪中攥着火种的鹰。",
    choices: [
      { label: "收起军旗", desc: "远征的信物认了新主人，队伍站得更直了。", risk: "低", effect: { type: "buffAll", value: 0.1 } },
      { label: "向军旗宣誓", desc: "誓言很重。应答，也很重。", risk: "中", effect: { type: "buffAtk", value: 0.2 } },
      { label: "撬开柱基", desc: "柱基里封着远征军当年留下的补给箱。", risk: "低", effect: { type: "freeItem", value: "远征军补给：随机一件装备" } },
    ],
  },
  {
    id: "abyssWhisper",
    name: "深渊低语",
    text: "黑暗里响起一个声音，用的是你最思念之人的嗓音。它只说了一句：「答案在更深处——把不重要的一切，都丢掉。」",
    choices: [
      { label: "倾听到底", desc: "低语一个字一个字烙进骨头，再洗不掉了。", risk: "高", effect: { type: "curseUntilPrestige", value: "深渊的低语：本次轮回如影随形" } },
      { label: "回应它的呼唤", desc: "黑暗尽头亮起一双眼睛。它等这一刻，已经等了很久。", risk: "高", effect: { type: "bossRush", value: "深渊应答：前方直迎一位深渊之主" } },
      { label: "捂耳快步离开", desc: "有些声音越听越真。跑出去时，你踢到了前人逃跑时掉的钱袋。", risk: "低", effect: { type: "goldGain", value: 50 } },
    ],
  },
  {
    id: "ashBard",
    name: "灰烬吟游诗人",
    text: "老诗人坐在篝火的灰烬旁，用一把断了两根弦的琴调音。他说他唱过太阳，唱过初火，唱过第七百个没有黎明的冬天。",
    choices: [
      { label: "听他唱完一曲", desc: "歌里是远征军旧日的战号，听得人攥紧了兵器。", risk: "低", effect: { type: "buffAtk", value: 0.12 } },
      { label: "请他为全队唱一段", desc: "整支队伍安静下来。歌声停时，所有人都站得更直了。", risk: "低", effect: { type: "buffAll", value: 0.08 } },
      { label: "抢走断弦琴", desc: "琴匣夹层里藏着他一辈子的积蓄——他的咒骂会跟你进每一层。", risk: "高", effect: { type: "relicRoll", value: "琴匣夹层：随机一件遗物" } },
    ],
  },
  {
    id: "sunkenVault",
    name: "沉没的宝库",
    text: "积水漫过石阶，水下隐约成排的金光。这里曾是初火远征的国库——如今沉在比夜晚更深的水底。",
    choices: [
      { label: "潜入水底", desc: "憋一口气，能捞多少是多少——水里未必只有金子。", risk: "高", effect: { type: "goldGain", value: 400 } },
      { label: "引水放空", desc: "花些时辰凿开泄水口，稳稳搬空一层库房。", risk: "低", effect: { type: "goldGain", value: 180 } },
      { label: "只取浮在水面上的", desc: "一只密封的军械匣浮而不沉，像在等人来取。", risk: "低", effect: { type: "freeItem", value: "密封军械匣：随机一件装备" } },
    ],
  },
];

// 传说级遗物的风味小字（id 必须与遗物表完全一致）
export const UNIQUE_FLAVOR = {
  thunderDawn: "雷声曾在黎明前滚过天空。这是它最后一次响起的形状。",
  bloodOath: "立誓的人早已死去，誓言还在替他流血。",
  emberCommander: "他到死都在下令。如今轮到这枚徽章发号施令。",
  stormBrand: "驯服风暴的人没有赢，只是成了风暴的一部分。",
  voidThirst: "它从不喝水。它只是想让靠近的一切都口渴。",
  basiliskScale: "别盯着它看太久——鳞片记得每一个注视过它的人。",
  cinderHeart: "初火熄灭那夜，有人把心换成灰烬，替它继续烧。",
  executionerScythe: "它从不磨刃。让它锋利的从来不是刀石，是判决。",
  merchantsLedger: "账本最后一页写着：太阳，一颗，欠款未清。",
  frostwail: "那声哭喊冻在第七百年的冬夜里，至今没有落地。",
  bloodmoonSigil: "无月的夜空下，它固执地记着月亮原本的样子。",
  phoenixFeather: "火死后的第七百年，据说灰烬深处有什么翻了个身。",
};

// 里程碑编年史文案（首次达成时写入 chronicle）
export const MILESTONE_TEXTS = {
  firstBoss: "斩落了第一位深渊之主。火光第一次照进王座的残骸。",
  firstPrestige: "火把交给了下一个自己。旧轮的伤疤烧成灵魂余烬，新的远征开始了。",
  companionVera: "秘法使·薇拉加入了远征。她精打细算每一点奥术余晖，却毫不犹豫把魔力倾泻向深渊。",
  companionIrene: "圣愈者·艾琳加入了远征。她不太说话，但她的圣光与护盾比任何誓言都可靠。",
  companionKai: "影刃·凯加入了远征。他一笑，篝火就旺一分；双匕掠过之处，暗影也得退让。",
  floor20: "抵达第 20 层。深渊在这里换了颜色——黑暗开始有了温度。",
  floor50: "抵达第 50 层。这里安静得像太阳死去的前一夜。",
};
