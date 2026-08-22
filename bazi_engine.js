/* =========================================================================
   bazi_engine.js —— 八字（四柱）计算引擎
   提供 computeBazi(input) 与 analyzeDrive(profile) 两个全局函数。
   input = { y, m, d, hh, mm, gender:'男'|'女' }
   返回完整的命盘结构与解读数据。
   算法说明：
     · 日柱：以 JDN（儒略日）推算，基准锚定 2000-01-07 为甲子日。
     · 年柱：以「立春」为界，立春前归入上一年。
     · 月柱：以十二节（立春/惊蛰/清明…大雪/小寒）划定月令，五虎遁起月干。
     · 时柱：以出生时辰（23-1 为子时）推算，五鼠遁起时干；晚子时取次日日干。
     · 节气：采用通用「寿星公式」（20/21 世纪 C 值表），覆盖 1900–2099。
   强弱、用神为简化判断，仅供个人参考，不作专业命理结论。
   ========================================================================= */
(function (global) {
  'use strict';

  const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const GAN_WX = [0,0,1,1,2,2,3,3,4,4];          // 木0 火1 土2 金3 水4
  const ZHI_WX = [4,2,0,0,2,1,1,2,3,3,2,4];
  const GAN_YIN = [1,0,1,0,1,0,1,0,1,0];          // 1阳 0阴
  const ZHI_YIN = [1,0,1,0,1,0,1,0,1,0,1,0];
  const WX_NAME = ['木','火','土','金','水'];
  const WX_COLOR = ['#5b8c7b','#c8694e','#b8924a','#8a837a','#4a7fb8'];

  // ===== 子平旺衰算法数据表（取自命理大师 skill · 子平真诠月令旺衰）=====
  // 天干 → 五行（字符映射）
  const STEM_ELEMENT = { '甲':'木','乙':'木','丙':'火','丁':'火','戊':'土','己':'土','庚':'金','辛':'金','壬':'水','癸':'水' };
  // 五行元素(0木1火2土3金4水) → 生我之元素
  const ELEMENT_GENBY = { '木':'水','火':'木','土':'火','金':'土','水':'金' };
  const ELEMENT_IDX = { '木':0,'火':1,'土':2,'金':3,'水':4 };
  const YANG_STEM_BY_ELEMENT = { '木':'甲','火':'丙','土':'戊','金':'庚','水':'壬' };
  // 地支藏干（主气/中气/余气）→ 字符（由 ZHANGAN 索引推导）
  const BRANCH_HIDDEN = {};
  // 月令旺衰分值表（子平真诠）：月支 → 该天干在此月得令分
  const MONTH_STRENGTH = {
    '寅': { '甲':100,'乙':80, '丙':70,'丁':60, '戊':50,'己':40, '庚':30,'辛':20, '壬':10,'癸':0 },
    '卯': { '甲':80, '乙':100,'丙':60,'丁':70, '戊':40,'己':50, '庚':20,'辛':30, '壬':10,'癸':0 },
    '辰': { '甲':60, '乙':70, '丙':70,'丁':80, '戊':70,'己':80, '庚':50,'辛':60, '壬':40,'癸':50 },
    '巳': { '甲':30, '乙':40, '丙':100,'丁':80,'戊':60,'己':50, '庚':40,'辛':30, '壬':10,'癸':0 },
    '午': { '甲':20, '乙':30, '丙':80,'丁':100,'戊':50,'己':60, '庚':30,'辛':40, '壬':0, '癸':10 },
    '未': { '甲':50, '乙':60, '丙':60,'丁':70, '戊':70,'己':80, '庚':50,'辛':60, '壬':20,'癸':30 },
    '申': { '甲':20, '乙':10, '丙':30,'丁':40, '戊':50,'己':60, '庚':100,'辛':80,'壬':70,'癸':50 },
    '酉': { '甲':10, '乙':20, '丙':20,'丁':30, '戊':40,'己':50, '庚':80,'辛':100,'壬':50,'癸':70 },
    '戌': { '甲':50, '乙':60, '丙':70,'丁':80, '戊':70,'己':80, '庚':50,'辛':60, '壬':40,'癸':50 },
    '亥': { '甲':70, '乙':60, '丙':20,'丁':30, '戊':30,'己':40, '庚':10,'辛':20, '壬':100,'癸':80 },
    '子': { '甲':50, '乙':40, '丙':10,'丁':20, '戊':20,'己':30, '庚':0, '辛':10, '壬':80,'癸':100 },
    '丑': { '甲':40, '乙':50, '丙':50,'丁':60, '戊':60,'己':70, '庚':50,'辛':60, '壬':50,'癸':60 }
  };
  // 通根加分表（该天干在地支有根之加分）
  const TONGGEEN_BONUS = {
    '甲': { '寅':50,'卯':40,'亥':20,'子':0, '辰':10,'未':10,'戌':10,'丑':5, '巳':0,'午':0,'申':0,'酉':0 },
    '乙': { '卯':50,'寅':30,'亥':10,'子':20,'辰':10,'未':15,'戌':10,'丑':10,'巳':0,'午':0,'申':0,'酉':0 },
    '丙': { '巳':50,'午':40,'寅':20,'卯':10,'申':0,'酉':0,'辰':5,'戌':10,'丑':5,'亥':0,'子':0,'未':10 },
    '丁': { '午':50,'巳':30,'未':15,'戌':10,'寅':10,'酉':0,'申':0,'辰':5,'丑':5,'亥':0,'子':0,'卯':5 },
    '戊': { '辰':40,'戌':40,'丑':30,'未':30,'巳':20,'午':30,'寅':5,'卯':5,'申':0,'酉':0,'亥':0,'子':0 },
    '己': { '丑':40,'未':40,'辰':30,'戌':30,'午':20,'巳':10,'寅':5,'卯':5,'申':0,'酉':0,'亥':5,'子':5 },
    '庚': { '申':50,'酉':40,'辰':15,'戌':15,'丑':20,'未':15,'寅':0,'卯':0,'巳':0,'午':0,'亥':0,'子':0 },
    '辛': { '酉':50,'申':30,'辰':10,'戌':10,'丑':15,'未':10,'寅':0,'卯':0,'巳':0,'午':0,'亥':0,'子':0 },
    '壬': { '亥':50,'子':40,'申':20,'酉':10,'辰':10,'戌':10,'丑':15,'寅':0,'卯':0,'巳':0,'午':0,'未':5 },
    '癸': { '子':50,'亥':40,'丑':20,'辰':10,'戌':10,'申':5,'酉':5,'寅':0,'卯':0,'巳':0,'午':0,'未':5 }
  };
  // 旺衰总分 → 等级（子平真诠）
  function strengthLevel(total) {
    if (total < 80)  return '极弱';
    if (total < 150) return '弱';
    if (total < 220) return '偏弱';
    if (total < 300) return '中和';
    if (total < 380) return '偏强';
    if (total < 450) return '强';
    return '极强';
  }

  // 地支藏干（本气/中气/余气），数值为天干索引
  const ZHANGAN = {
    0:[9], 1:[5,9,7], 2:[0,2,4], 3:[1], 4:[4,1,9], 5:[2,3,4],
    6:[3,5], 7:[5,3,1], 8:[6,8,4], 9:[7], 10:[4,7,3], 11:[8,0,4]
  };
  // 地支藏干（主气/中气/余气）→ 天干字符（需在 ZHANGAN 之后填充）
  (function () {
    const order = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    order.forEach((z, i) => {
      const arr = ZHANGAN[i];
      BRANCH_HIDDEN[z] = { 主气: GAN[arr[0]], 中气: arr[1] != null ? GAN[arr[1]] : null, 余气: arr[2] != null ? GAN[arr[2]] : null };
    });
  })();

  // 十二节（月令分界），index: 0小寒 1立春 2惊蛰 3清明 4立夏 5芒种 6小暑 7立秋 8白露 9寒露 10立冬 11大雪
  const TERM_NAME = ['小寒','立春','惊蛰','清明','立夏','芒种','小暑','立秋','白露','寒露','立冬','大雪'];
  // 寿星公式 C 值（日，近似）
  const C21 = [5.4055,3.87,5.63,4.81,5.52,5.678,7.108,7.5,7.646,8.318,7.438,7.18];
  const C20 = [6.11,4.6295,6.3826,5.59,6.318,6.5,7.928,8.35,8.44,9.098,8.218,7.9];
  const ZHI_MONTH = [1,2,3,4,5,6,7,8,9,10,11,0];   // 节 index -> 月支

  // ---------- 基础工具 ----------
  function jdn(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy
         + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }
  function dayGZ(y, m, d) {
    const g = ((jdn(y, m, d) - 2451551) % 60 + 60) % 60; // 锚: 2000-01-07 甲子
    return { gan: g % 10, zhi: g % 12 };
  }
  function hourZhi(h) {
    if (h === 23 || h === 0) return 0;
    return Math.floor((h + 1) / 2) % 12;
  }
  function solarTermDate(y, idx) {
    const Yc = y >= 2000 ? y - 2000 : y - 1900;
    const C = y >= 2000 ? C21[idx] : C20[idx];
    let day;
    if (y >= 2000) day = Math.floor(Yc * 0.2422 + C) - Math.floor((Yc - 1) / 4);
    else day = Math.floor(Yc * 0.2422 + C) - Math.floor(Yc / 4);
    return new Date(y, idx, day, 0, 0, 0);
  }

  // 十神：日主 dm，目标天干 tg（均为索引）
  function shiShen(dm, tg) {
    const dw = GAN_WX[dm], tw = GAN_WX[tg];
    const dy = GAN_YIN[dm], ty = GAN_YIN[tg];
    if (dw === tw) return dy === ty ? '比肩' : '劫财';
    if ((dw + 1) % 5 === tw) return dy === ty ? '食神' : '伤官';   // 我生
    if ((dw + 2) % 5 === tw) return dy === ty ? '偏财' : '正财';   // 我克
    if ((tw + 2) % 5 === dw) return dy === ty ? '七杀' : '正官';   // 克我
    if ((tw + 1) % 5 === dw) return dy === ty ? '偏印' : '正印';   // 生我
    return '?';
  }
  const SS_COLOR = {
    '比肩':'#5b8c7b','劫财':'#7fae9c',
    '食神':'#4a7fb8','伤官':'#6f9fd0',
    '正财':'#b8924a','偏财':'#c9a85e',
    '正官':'#8a6db0','七杀':'#a07fc4',
    '正印':'#c8694e','偏印':'#d98a6e'
  };

  // ---------- 主计算 ----------
  function computeBazi(input) {
    const { y, m, d, hh, mm, gender } = input;
    const birth = new Date(y, m - 1, d, hh, mm);

    // 年柱
    const lichun = solarTermDate(y, 1);
    let ly = y;
    if (birth < lichun) ly = y - 1;
    const yIdx = ((ly - 4) % 60 + 60) % 60;
    const year = { gan: yIdx % 10, zhi: yIdx % 12 };

    // 月柱
    const terms = [
      { idx:11, date:solarTermDate(y-1,11) }, { idx:0, date:solarTermDate(y,0) },
      { idx:1, date:solarTermDate(y,1) }, { idx:2, date:solarTermDate(y,2) },
      { idx:3, date:solarTermDate(y,3) }, { idx:4, date:solarTermDate(y,4) },
      { idx:5, date:solarTermDate(y,5) }, { idx:6, date:solarTermDate(y,6) },
      { idx:7, date:solarTermDate(y,7) }, { idx:8, date:solarTermDate(y,8) },
      { idx:9, date:solarTermDate(y,9) }, { idx:10,date:solarTermDate(y,10) },
      { idx:11,date:solarTermDate(y,11) }, { idx:0, date:solarTermDate(y+1,0) }
    ];
    let chosen = terms[0];
    for (const t of terms) if (t.date <= birth) chosen = t;
    const mzhi = ZHI_MONTH[chosen.idx];
    const startGan = [2,4,6,8,0,2,4,6,8,0][year.gan];
    const mgan = (startGan + (mzhi - 2) + 60) % 10;
    const month = { gan: mgan, zhi: mzhi, term: TERM_NAME[chosen.idx] };

    // 日柱（日主）
    const dg = dayGZ(y, m, d);
    const day = { gan: dg.gan, zhi: dg.zhi };
    const dm = dg.gan; // 日主天干
    const dmWx = GAN_WX[dm];

    // 时柱
    const hz = hourZhi(hh);
    const baseGan = (hh === 23) ? (dm + 1) % 10 : dm; // 晚子时取次日日干
    const startZi = [0,2,4,6,8,0,2,4,6,8][baseGan];
    const hgan = (startZi + hz) % 10;
    const hour = { gan: hgan, zhi: hz };

    // 天干十神
    const ganSS = {
      year: shiShen(dm, year.gan),
      month: shiShen(dm, month.gan),
      day: '日主',
      hour: shiShen(dm, hour.gan)
    };

    // 地支本气十神 + 藏干十神
    const pillars = [
      { key:'year',  g:year.gan,  z:year.zhi },
      { key:'month', g:month.gan, z:month.zhi },
      { key:'day',   g:day.gan,   z:day.zhi },
      { key:'hour',  g:hour.gan,  z:hour.zhi }
    ];
    const zhiSS = {};
    const hidden = {};
    pillars.forEach(p => {
      const zg = ZHANGAN[p.z];
      const list = zg.map((g, i) => ({
        g, ss: shiShen(dm, g),
        role: i === 0 ? '本气' : (i === 1 ? '中气' : '余气')
      }));
      hidden[p.key] = list;
      zhiSS[p.key] = list[0].ss;
    });

    // 五行分布（天干计1 + 地支本气计1）
    const wxCount = [0,0,0,0,0];
    [year.gan, month.gan, day.gan, hour.gan].forEach(g => wxCount[GAN_WX[g]]++);
    pillars.forEach(p => wxCount[ZHI_WX[p.z]]++);
    const wxTotal = wxCount.reduce((a,b)=>a+b,0);

    // 强弱判断
    const deling = (ZHI_WX[month.zhi] === dmWx) || ((ZHI_WX[month.zhi] + 1) % 5 === dmWx);
    let didi = 0;
    pillars.forEach(p => { if (ZHANGAN[p.z].some(g => GAN_WX[g] === dmWx)) didi++; });
    let deshi = 0;
    [year.gan, month.gan, hour.gan].forEach(g => { if (GAN_WX[g] === dmWx) deshi++; });
    const strongItems = (deling?1:0) + (didi >= 2 ? 1 : 0) + (deshi >= 2 ? 1 : 0);
    let level, levelNote;
    if (strongItems >= 2) { level = '身强'; levelNote = '日主得令、得地、得势中占两项以上，自身能量充沛。'; }
    else if (strongItems === 0) { level = '身弱'; levelNote = '日主缺少生扶依托，自身能量偏弱，需外援。'; }
    else { level = '中和'; levelNote = '日主强弱兼顾，宜看具体组合与流年取舍。'; }

    // 用神喜忌
    const keOf = a => (a + 3) % 5;       // 克 a 之五行
    const shengOf = a => (a + 4) % 5;    // 生 a 之五行
    const woSheng = (dmWx + 1) % 5;      // 我生
    const woKe = (dmWx + 2) % 5;         // 我克
    let xiWx, jiWx, xiTen, jiTen;
    if (level === '身强') {
      xiWx = [keOf(dmWx), woSheng, woKe]; jiWx = [shengOf(dmWx), dmWx];
      xiTen = ['官杀','食伤','财']; jiTen = ['印','比劫'];
    } else if (level === '身弱') {
      xiWx = [shengOf(dmWx), dmWx]; jiWx = [keOf(dmWx), woSheng, woKe];
      xiTen = ['印','比劫']; jiTen = ['官杀','食伤','财'];
    } else {
      xiWx = [shengOf(dmWx), dmWx, keOf(dmWx)]; jiWx = [woSheng, woKe];
      xiTen = ['印','比劫','官杀']; jiTen = ['食伤','财'];
    }

    // 大运
    const yangYear = GAN_YIN[year.gan] === 1;
    const male = gender === '男';
    const forward = (yangYear && male) || (!yangYear && !male);
    const cands = [];
    for (let yy = y - 1; yy <= y + 1; yy++) for (let i = 0; i < 12; i++) cands.push(solarTermDate(yy, i));
    cands.sort((a,b)=>a-b);
    let termDate;
    if (forward) termDate = cands.find(c => c > birth);
    else termDate = [...cands].reverse().find(c => c < birth);
    const diffDays = Math.abs((termDate - birth) / 86400000);
    const startAge = Math.round(diffDays / 3 * 10) / 10;
    const dayun = [];
    for (let i = 1; i <= 8; i++) {
      let g, z;
      if (forward) { g = (month.gan + i) % 10; z = (month.zhi + i) % 12; }
      else { g = ((month.gan - i) % 10 + 10) % 10; z = ((month.zhi - i) % 12 + 12) % 12; }
      dayun.push({ gan:g, zhi:z, ageFrom: Math.round(startAge + (i-1)*10), ageTo: Math.round(startAge + (i-1)*10) + 10 });
    }

    // 十神权重（用于核心驱动力）
    const bucket = {'比肩':0,'劫财':0,'食神':0,'伤官':0,'正财':0,'偏财':0,'正官':0,'七杀':0,'正印':0,'偏印':0};
    // 天干 权重1.5
    [year.gan, month.gan, hour.gan].forEach(g => { bucket[shiShen(dm,g)] += 1.5; });
    // 地支本气1.0 + 中余气0.4
    pillars.forEach(p => {
      ZHANGAN[p.z].forEach((g,i) => { bucket[shiShen(dm,g)] += i === 0 ? 1.0 : 0.4; });
    });
    const driveW = {
      '食伤': bucket['食神'] + bucket['伤官'],
      '财':   bucket['正财'] + bucket['偏财'],
      '官杀': bucket['正官'] + bucket['七杀'],
      '印':   bucket['正印'] + bucket['偏印'],
      '比劫': bucket['比肩'] + bucket['劫财']
    };

    const profile = {
      input, birth,
      year, month, day, hour, dayMaster: dm, dmWx,
      ganSS, zhiSS, hidden,
      wxCount, wxTotal,
      strength: { level, deling, didi, deshi, note: levelNote },
      yongshen: { xiWx, jiWx, xiTen, jiTen },
      dayun: { startAge, forward, list: dayun },
      bucket, driveW
    };
    profile.drive = analyzeDrive(profile);
    return profile;
  }

  // ---------- 核心驱动力分析 ----------
  const DRIVE_INFO = {
    '食伤': { title:'表达与创造', icon:'✎',
      desc:'你天生的发动机是「我想表达、我想创造」。食伤代表才华、创意、自由与输出欲——你渴望把自己的想法具象化，讨厌被框死。',
      blind:'容易想法多而落地少，或言多招忌；适度收敛锋芒、把创造变成作品，是关键。' },
    '财': { title:'现实与成就', icon:'❖',
      desc:'你被「看得见的价值」驱动。财星代表资源、成果与世俗成就——你做事讲究回报与意义，乐于把事情做成、把局面盘活。',
      blind:'过度追逐结果可能忽略关系与内在；记住钱是能量流动，不是终点。' },
    '官杀': { title:'责任与秩序', icon:'⚑',
      desc:'你被「该做的事」推动。官杀代表规则、目标与担当——你重视信誉、结构与掌控感，压力下反而能激发你的秩序力。',
      blind:'自我要求过高易紧绷；学会把掌控换成信任，给他人也给自己留白。' },
    '印': { title:'安全与意义', icon:'❀',
      desc:'你被「踏实与懂」驱动。印星代表学习、庇护与内在秩序——你渴望理解世界、积累底气，在安稳中才敢舒展。',
      blind:'想得透却容易停在舒适区；把「懂了」变成「做了」，成长更快。' },
    '比劫': { title:'关系与归属', icon:'⟡',
      desc:'你被「在一起」驱动。比劫代表同频的人、协作与并肩——你在关系里汲取能量，重视情义与团队，孤军奋战反而疲惫。',
      blind:'太在意旁人评价会迷失自己；先立住内核，关系才 healthy。' }
  };

  function analyzeDrive(p) {
    const w = p.driveW;
    const entries = Object.entries(w).sort((a,b)=>b[1]-a[1]);
    const core = entries[0][0];
    const second = entries[1][0];
    const total = entries.reduce((s,e)=>s+e[1],0) || 1;
    const pct = {};
    Object.keys(w).forEach(k => pct[k] = Math.round(w[k]/total*100));
    // 日主天性
    const dmNature = DAY_MASTER[GAN[p.dayMaster]];
    // 成长方向 = 用神十神
    const grow = p.yongshen.xiTen;
    return {
      core, second, weights:w, pct,
      coreInfo: DRIVE_INFO[core],
      secondInfo: DRIVE_INFO[second],
      dmNature,
      growTen: grow,
      growWx: p.yongshen.xiWx.map(i=>WX_NAME[i]),
      theme: buildTheme(p, core, second)
    };
  }

  function buildTheme(p, core, second) {
    const lv = p.strength.level;
    let t = `日主${GAN[p.dayMaster]}${WX_NAME[p.dmWx]}，命局${lv}。`;
    t += `你的核心驱动力落在「${DRIVE_INFO[core].title}」，辅以「${DRIVE_INFO[second].title}」。`;
    if (lv === '身强') t += '自身能量足，适合主动出击、把驱动力转化为对外产出。';
    else if (lv === '身弱') t += '能量需涵养，先稳住内核与依托，再让驱动力从容展开。';
    else t += '强弱均衡，随流年与大运在「收」与「放」之间灵活切换。';
    return t;
  }

  // 日主天性简介
  const DAY_MASTER = {
    '甲':{ wx:'木', yin:'阳', txt:'如参天大树，向上生长、有担当，天生带着引领与开拓的气质。' },
    '乙':{ wx:'木', yin:'阴', txt:'如藤蔓花草，柔韧善变、懂得借势，以巧劲迂回前行。' },
    '丙':{ wx:'火', yin:'阳', txt:'如太阳当空，热情外放、感染力强，天然是聚光灯下的存在。' },
    '丁':{ wx:'火', yin:'阴', txt:'如灯烛之光，细腻温暖、持久专注，于细微处见真心。' },
    '戊':{ wx:'土', yin:'阳', txt:'如高山厚土，沉稳可信、包容承载，是让人安心的依靠。' },
    '己':{ wx:'土', yin:'阴', txt:'如田园之土，温润务实、善于调和，在烟火里把日子过好。' },
    '庚':{ wx:'金', yin:'阳', txt:'如出鞘之剑，刚毅果决、不畏挑战，越磨砺越锋利。' },
    '辛':{ wx:'金', yin:'阴', txt:'如精金美玉，讲究质地、审美独到，于精致中见锋芒。' },
    '壬':{ wx:'水', yin:'阳', txt:'如江河奔涌，自在通透、智计灵动，不喜被束缚。' },
    '癸':{ wx:'水', yin:'阴', txt:'如晨露细雨，润物无声、感知敏锐，于静默中滋养万物。' }
  };

  // 五行简介
  const WX_DESC = {
    '木':'生发、舒展、向上', '火':'光明、热情、向外',
    '土':'承载、稳定、调和', '金':'收敛、决断、成器', '水':'流动、智慧、潜藏'
  };

  // ---------- 五驱动力能量值（子平旺衰法）----------
  // 每个十神组对应一个五行元素，能量值 = 该元素在命局中的旺衰总分
  //   （月令分 + 比劫/同类分 + 通根分 + 印绶/生我分），整数，无单位。
  // 比劫 用日主本身为参照；其余四组用该元素的阳干为代表计算。
  function computeDriveEnergies(p) {
    const dm = p.dayMaster;            // 日主天干索引
    const dmWx = p.dmWx;               // 日主五行(0-4)
    const monthBranch = ZHI[p.month.zhi];
    const allStems = [GAN[p.year.gan], GAN[p.month.gan], GAN[p.day.gan], GAN[p.hour.gan]];
    const allBranches = [ZHI[p.year.zhi], ZHI[p.month.zhi], ZHI[p.day.zhi], ZHI[p.hour.zhi]];
    const dayStemChar = GAN[dm];

    function strengthFor(repStem, excludeSelf) {
      const myElement = STEM_ELEMENT[repStem];
      const genBy = ELEMENT_GENBY[myElement];
      const monthScore = (MONTH_STRENGTH[monthBranch] || {})[repStem] || 0;
      // 同类（比劫）分：天干同五行 + 地支藏干
      let biJie = 0;
      allStems.forEach(s => { if (s !== excludeSelf && STEM_ELEMENT[s] === myElement) biJie += 20; });
      allBranches.forEach(z => {
        const h = BRANCH_HIDDEN[z] || {};
        const w = { 主气:15, 中气:8, 余气:5 };
        ['主气','中气','余气'].forEach(k => { if (h[k] && STEM_ELEMENT[h[k]] === myElement) biJie += w[k]; });
      });
      // 通根分
      let tonggen = 0;
      allBranches.forEach(z => { tonggen += (TONGGEEN_BONUS[repStem] || {})[z] || 0; });
      // 印绶（生我者）分
      let yin = 0;
      allStems.forEach(s => { if (STEM_ELEMENT[s] === genBy) yin += 15; });
      allBranches.forEach(z => {
        const h = BRANCH_HIDDEN[z] || {};
        const w = { 主气:10, 中气:5, 余气:3 };
        ['主气','中气','余气'].forEach(k => { if (h[k] && STEM_ELEMENT[h[k]] === genBy) yin += w[k]; });
      });
      return monthScore + biJie + tonggen + yin;
    }

    const groups = {
      '比劫': { element: dmWx,            rep: dayStemChar,    exclude: dayStemChar },
      '食伤': { element: (dmWx + 1) % 5,  rep: YANG_STEM_BY_ELEMENT[WX_NAME[(dmWx+1)%5]], exclude: null },
      '财':   { element: (dmWx + 2) % 5,  rep: YANG_STEM_BY_ELEMENT[WX_NAME[(dmWx+2)%5]], exclude: null },
      '官杀': { element: (dmWx + 3) % 5,  rep: YANG_STEM_BY_ELEMENT[WX_NAME[(dmWx+3)%5]], exclude: null },
      '印':   { element: (dmWx + 4) % 5,  rep: YANG_STEM_BY_ELEMENT[WX_NAME[(dmWx+4)%5]], exclude: null }
    };

    const energies = {}, levels = {};
    const rawVals = {};
    Object.keys(groups).forEach(k => {
      rawVals[k] = Math.round(strengthFor(groups[k].rep, groups[k].exclude));
    });
    const vals = Object.values(rawVals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // 旺衰等级＝相对本命五驱动力均值判定（过强/过弱均为过度态）
    Object.keys(groups).forEach(k => {
      const e = rawVals[k];
      energies[k] = e;
      const ratio = e / mean;
      if (ratio >= 1.6)      levels[k] = '强';   // 过强·过度
      else if (ratio <= 0.55) levels[k] = '弱';   // 过弱·过度（不足）
      else                    levels[k] = '中和';  // 平衡·用
    });
    return { energies, levels };
  }

  global.BaziEngine = {
    computeBazi, analyzeDrive, computeDriveEnergies, strengthLevel,
    GAN, ZHI, GAN_WX, ZHI_WX, GAN_YIN, ZHI_YIN, WX_NAME, WX_COLOR,
    SS_COLOR, DAY_MASTER, WX_DESC, DRIVE_INFO, TERM_NAME, ZHANGAN, shiShen
  };
})(window);
