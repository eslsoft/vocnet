# 话题与场景（方案，2026-11-22）

## 1. 背景

现在的 `topics` 表把两种东西放进了同一棵树：

- **话题**：这个义项讲的是什么，比如水果、情绪、物理。
- **场景**：学习者在什么情境下要用到它，比如机场乘机、餐厅点餐、求职面试。

评审标准问的是场景的问题：「学习者主要在哪里碰到或用到这个义项」。可是这个标准又被套在话题上，于是出现了三种毛病：

1. **常用词的偏门义项挤在前面。** 在 18,918 条挂接里，只有 43% 挂的是这个词的第一个义项，24% 挂的是第 4 个及以后的义项。`run` 挂了 26 个话题。「球类运动」开头是 in、up、out，`ball`、`goal` 反而在后面。
2. **核心词没地方挂。** `travel` 被机场、观光、问路逐个判成「太泛」，最后只挂在「营销销售」。`medal` 只挂在「军事战争」。评审在「不挂」的理由里，有 696 次说没有合适的叶子。
3. **大杂烩。** 「情绪」有 609 个义项，「沟通方式」有 575 个，「政府政治」有 520 个。「沟通方式」里其实是 say、tell、ask 这类普通动词。

## 2. 目标

- 话题和场景拆成两套资源，各用各的评审标准。
- **话题**：按词义分类，是一棵稳定的树，回答「这个词是哪一类」。
- **场景**：按用途挑词，是一份情境清单，回答「到这里我要会什么」。场景里除了义项，也能收短语和口语语块。
- 一个领域的核心词排在前面；常用词的专业义项可以挂，但单独列出。
- 粗俗、冒犯性的义项不进任何公开列表。

## 3. 话题和场景的关系

场景不等于几个话题的并集，也不等于它们的交集：

- **并集太宽。** 「餐厅点餐」如果等于「食物 ∪ 付款 ∪ 餐具」，整个食物领域都会进来，lettuce 也会进来，可点餐用不到它。
- **交集太窄。** 「食物 ∩ 付款」几乎是空的，可 menu、waiter、tip、order 都该在场景里。

所以场景**关联**若干话题，关联只有两个用途：

- 给场景出候选词；
- 在页面上互相跳转。

场景里有哪些词，仍然按场景标准逐个判，不靠话题算出来。

## 4. 话题

### 4.1 划分原则

1. **只按词义分。** 一个义项挂在哪个话题，只看它的意思属于哪个领域。学习者在什么情境下用到它，归场景管。
2. **以牛津高阶词典的话题分类为底。** 这是《牛津高阶英汉双解词典》网站的 Topic Dictionaries：
   - 它是给学习者用的，每个词表都能按 CEFR 级别筛选；
   - 共三级：18 个一级、76 个二级、480 个三级。

   我们只采用它的分类结构，词表由我们自己挂。
3. **现在只建两级，三级预留。** 一级、二级基本照牛津，改动见下面两条，补充见 4.4。牛津的三级不建，只记在附录里，用来说明每个二级管哪些词；以后某个二级太大、需要细分时，再从这里启用。
4. **「教育」提成一级。** 牛津把它放在「人物」下。它是学习者和雅思最常用的话题之一，单列更好找。它的二级由我们按牛津的 11 个三级归并成 4 个。
5. **「运动」的二级重分。** 牛津的「其他运动」把体育通用词、田径、冰雪、格斗混在一起，所以拆成冰雪运动、格斗运动、田径与其他运动三个。体育通用词（sport、athlete、medal、coach）挂在一级「运动」本身。
6. **用另外两份清单查漏。** owner 给的 19 个话题和雅思常考话题都拿来对照，牛津缺的才补，见 4.4。
7. **动物按种类分，不按和人的关系分。** 宠物、农场动物在牛津里是「兽类」下的三级，我们照这样放。养宠物、参观农场这类事交给场景。

### 4.2 挂接规则

- 一个义项挂在它的意思完全属于的那个二级上，比如 apple 挂「饮食 / 食物」。
- 意思属于一个一级、但不专属于其中任何二级的通用词，挂在一级本身，比如 sport 挂「运动」，`travel` 挂「旅行与交通」。一级的列表 = 自己的义项 + 所有二级的义项。
- 评审标准：**这个义项的意思属于这个领域吗？** 也就是说，它是不是这个领域里的事物、动作、性质或概念。
- 每条挂接分「核心词」和「专门义项」两类，由服务端从数据算出，不用代理提交，也不用单独评审：
  - **核心词**：这个义项就是词条的主义项（义项清单里的第一个），或者主义项在同一个一级下也有挂接，比如 apple、referee、thermometer；
  - **专门义项**：其余的挂接，即常用词在这个领域里的专门意思，比如挡位义的 first、界内义的 in。

  列表先列核心词，专门义项单独放一组。
- 功能词不挂话题。
- 一个义项最多挂 3 个话题，这一点不变。

### 4.3 话题树（草案）

19 个一级、89 个二级。★ 是我们补的，原因见 4.4。每个二级预留的三级列在附录。

#### 动物 Animals

| 二级 | 收什么 | 例词 |
|---|---|---|
| 兽类与其他动物 `animals` | 哺乳动物、爬行两栖动物，以及动物的身体、行为、巢穴；宠物、农场动物、役用动物作为种类收在这里 | dog, horse, lion, snake, tail, bark |
| 鸟类 `birds` | 鸟的种类、身体部位和行为 | eagle, feather, wing, nest |
| 鱼类与水生动物 `fish-and-shellfish` | 鱼、贝类和其他海洋动物 | salmon, shark, crab, fin |
| 昆虫与小动物 `insects-worms` | 昆虫、蜘蛛、蠕虫等无脊椎动物 | bee, ant, spider, worm |

#### 外貌 Appearance

| 二级 | 收什么 | 例词 |
|---|---|---|
| 长相与打扮 `looks` | 体型、发型、皮肤、表情、姿态、化妆品，以及对长相的评价 | tall, curly, beard, smile, pretty |
| 身体 `body` | 身体部位与器官，只管叫什么、在哪里；生病受伤归「健康」 | arm, knee, heart, tooth |
| 服装与时尚 `clothes-and-fashion` | 衣服、鞋帽、配饰、首饰和穿着 | shirt, boot, scarf, ring, wear |
| 颜色与形状 `colours-and-shapes` | 颜色和形状 | red, pale, circle, square |

#### 交流 Communication

| 二级 | 收什么 | 例词 |
|---|---|---|
| 语言 `language` | 语言本身：语种、语法、语音、标点、语言技能 | noun, accent, comma, fluent |
| 电话、邮件与互联网 `phones-and-internet` | 通讯设备和网络：电话、短信、邮件、网站、社交媒体 | call, text, inbox, website, post |
| ★说话与交谈 `speaking` | 说、讲、问、答、聊、喊这类言语动作和说话方式；表达观点、同意反对归「思维与表达」 | say, tell, ask, reply, chat, whisper |

#### 文化 Culture

| 二级 | 收什么 | 例词 |
|---|---|---|
| 美术 `art` | 绘画、雕塑等视觉艺术和美术界 | painting, sculpture, canvas, gallery |
| 影视与戏剧 `film-and-theatre` | 电影、戏剧的制作、演出、类型和从业者 | film, actor, stage, director |
| 文学与写作 `literature-and-writing` | 故事、诗歌、书籍、写作和出版 | novel, poem, chapter, author |
| 音乐 `music` | 音乐、乐器、演出、风格和从业者 | guitar, concert, melody, jazz |
| 广播电视与新闻 `tv-radio-news` | 电视广播节目、新闻报道和媒体从业者 | channel, broadcast, headline, journalist |

#### 饮食 Food and drink

| 二级 | 收什么 | 例词 |
|---|---|---|
| 烹饪与用餐 `cooking-and-eating` | 做饭、厨具、餐桌、三餐、饮食习惯、外出就餐和味道口感 | boil, pan, fork, dinner, menu, spicy |
| 饮品 `drinks` | 酒类和非酒类饮品，以及喝和调制 | coffee, juice, wine, sip |
| 食物 `food` | 食物本身：水果坚果、蔬菜、肉鱼海鲜、主食、奶与油脂、香料、酱料、菜肴、甜点 | apple, carrot, rice, cheese, cake |

#### 教育 Education

| 二级 | 收什么 | 例词 |
|---|---|---|
| 中小学 `schools` | 学校类型、在校学习和学校生活、学校里的人、受教育机会 | school, pupil, uniform, homework |
| 教与学 `teaching-and-learning` | 教学、学习，以及科目和课程 | teach, lesson, subject, maths, course |
| 考试与学历 `exams-and-qualifications` | 考试、评分、证书和学位 | exam, grade, pass, degree |
| 高等教育 `higher-education` | 大学、学院和大学里的人 | university, lecture, professor, campus |

#### 思维与表达 Functions

| 二级 | 收什么 | 例词 |
|---|---|---|
| ★思考与记忆 `thinking-and-memory` | 思考、理解、知道、记得、想象这类心理活动 | think, know, understand, remember, imagine |
| 讨论与协商 `discussion-and-agreement` | 讨论、协商、劝说、达成或终止协议、合作 | discuss, negotiate, persuade, deal |
| 确定与可能 `doubt-and-certainty` | 确定、怀疑、猜测、可能性 | sure, doubt, guess, probably |
| 观点与争论 `opinion-and-argument` | 形成和表达观点、同意与反对、争论 | opinion, agree, argue, point |
| 许可与义务 `permission-and-obligation` | 允许、禁止、必须、规则 | allow, ban, must, rule |
| 喜好与决定 `preferences-and-decisions` | 喜欢、讨厌、偏好、做决定 | like, hate, prefer, decide |
| 建议 `suggestions-and-advice` | 提建议、给忠告 | suggest, advise, recommend |

#### 健康 Health

| 二级 | 收什么 | 例词 |
|---|---|---|
| 健康与健身 `health-and-fitness` | 身体健康和锻炼 | fit, healthy, exercise, jog |
| 疾病与伤痛 `health-problems` | 生病、受伤、成瘾、康复 | flu, fever, injury, recover |
| 医疗 `healthcare` | 医院、医护人员、检查、手术、药物和医疗器械 | doctor, nurse, surgery, pill |
| 心理健康 `mental-health` | 心理问题和心理治疗 | depression, anxiety, therapy |
| 残障 `disability` | 残障类型和残障人士的生活 | blind, deaf, wheelchair |

#### 居家与建筑 Homes and buildings

| 二级 | 收什么 | 例词 |
|---|---|---|
| 住房与家居 `houses-and-homes` | 房型、房间、家具、家电、家务、装修、买房租房 | bedroom, sofa, fridge, rent, vacuum |
| 建筑 `buildings` | 建筑物的类型、结构、风格和建造 | tower, roof, castle, construction |
| 花园与园艺 `gardens` | 花园和园艺活动 | lawn, hedge, dig, plant |
| ★城镇与城市 `towns-and-cities` | 城市和城镇本身：街道、市中心、郊区、社区、城市规划 | street, downtown, suburb, neighbourhood |
| ★工具与维修 `tools-and-repairs` | 工具和修理、安装 | hammer, drill, screw, fix |

#### 休闲 Leisure

| 二级 | 收什么 | 例词 |
|---|---|---|
| 游戏与玩具 `games-and-toys` | 各类游戏（棋牌、电子游戏、儿童游戏）和玩具 | chess, dice, puzzle, doll |
| 爱好与手工 `hobbies` | 兴趣爱好和手工技艺 | hobby, knit, collect, craft |
| 购物 `shopping` | 商店、购物方式和付款 | shop, store, cashier, discount |

#### 概念 Notions

| 二级 | 收什么 | 例词 |
|---|---|---|
| ★描述事物 `describing-things` | 大小、速度、轻重、新旧、好坏等描述事物的性质 | big, quick, heavy, ordinary, excellent |
| ★感官与声音 `senses-and-sounds` | 看、听、闻、尝、触和各种声音 | see, hear, smell, noise, loud |
| 变化与因果 `change-cause-effect` | 变化、原因和结果 | change, become, cause, result |
| 危险与安全 `danger` | 危险的人和事、涉险、防范 | danger, risk, safe, warn |
| 困难与失败 `difficulty-and-failure` | 困难、失败和导致失败 | difficult, problem, fail, mistake |
| 成功 `success` | 成功、成就、抱负 | succeed, achieve, win, ambition |

#### 人物 People

| 二级 | 收什么 | 例词 |
|---|---|---|
| 家庭与关系 `family-and-relationships` | 亲属、朋友、恋爱、婚姻关系的结束、名字 | mother, cousin, friend, date, divorce |
| 情感 `feelings` | 各种情绪和感受 | happy, angry, afraid, bored, lonely |
| 人生阶段 `life-stages` | 出生、童年、成年、婚姻、老年、死亡 | baby, teenager, wedding, retire, die |
| 个人品质 `personal-qualities` | 性格和品行 | kind, lazy, brave, honest, shy |

#### 政治与社会 Politics and society

| 二级 | 收什么 | 例词 |
|---|---|---|
| 政治 `politics` | 政府、议会、选举、政治人物、国际关系、政治观点 | government, vote, minister, treaty |
| 法律与司法 `law-and-justice` | 法律、法律文件、诉讼程序、法律人士和警察 | law, court, judge, sue |
| 犯罪与惩罚 `crime-and-punishment` | 犯罪类型、罪犯、破案、刑罚、监狱 | theft, thief, arrest, prison |
| 战争与冲突 `war-and-conflict` | 战争、军队、武器、恐怖主义、维和 | war, soldier, weapon, army |
| 社会问题 `social-issues` | 贫困、失业、毒品、移民、抗议、社会公正、助人 | poverty, refugee, protest, charity |
| 社会群体 `people-in-society` | 社会归属、性别、种族、阶层与地位 | citizen, gender, race, class |
| 宗教与节日 `religion-and-festivals` | 宗教信仰、仪式、场所、人物，以及节日和庆祝 | god, church, pray, Christmas, festival |

#### 科学与技术 Science and technology

| 二级 | 收什么 | 例词 |
|---|---|---|
| 生物 `biology` | 生物学和遗传学 | cell, gene, organism, evolve |
| 物理与化学 `physics-and-chemistry` | 物质、能量、力、材料及其性质、化学 | atom, gravity, acid, metal |
| 数学与计量 `maths-and-measurement` | 数字、数学术语、计量单位 | number, equation, metre, kilogram |
| 科学研究 `scientific-research` | 学科分支、实验、数据、结果、科研设备 | experiment, data, theory, laboratory |
| 计算机 `computers` | 硬件、软件、编程、使用电脑和电脑故障 | keyboard, software, code, crash |
| 工程与机器 `engineering` | 工程门类、电子、机器设备和它们的工作原理 | engine, circuit, machine, gear |

#### 运动 Sport

| 二级 | 收什么 | 例词 |
|---|---|---|
| 球类与拍类运动 `ball-and-racket-sports` | 足球、篮球、网球、高尔夫等 | football, goal, racket, referee |
| 水上运动 `water-sports` | 游泳、潜水、划船等 | swim, dive, sail, surf |
| 冰雪运动 `winter-sports` | 滑雪、滑冰等 | ski, skate, slope |
| 格斗运动 `combat-sports` | 拳击、摔跤、武术等 | boxing, wrestle, karate |
| 田径与其他运动 `athletics-and-other-sports` | 田径、自行车、马术、极限运动、台球等 | race, marathon, cycling, jockey |

#### 自然 The natural world

| 二级 | 收什么 | 例词 |
|---|---|---|
| 地理 `geography` | 地形、山川、河湖、海岸、国家与大洲 | mountain, valley, river, coast, continent |
| 天气 `weather` | 天气状况、雨雪风、气温、天空 | rain, storm, cloudy, temperature |
| 环境 `environment` | 气候变化、保护、自然灾害、能源、污染和垃圾 | pollution, recycle, flood, solar |
| 植物 `plants-and-trees` | 植物和树木 | flower, leaf, oak, grass |
| 农业 `farming` | 种植、养殖和农场 | farm, crop, harvest, tractor |

#### 时间与空间 Time and space

| 二级 | 收什么 | 例词 |
|---|---|---|
| 时间 `time` | 日期、星期、月份、时段、时区和时间表达 | Monday, month, century, early |
| ★位置与方向 `position-and-direction` | 位置、方向和距离 | left, north, distance, corner |
| 历史 `history` | 历史时期、事件、人物、文物和史料 | ancient, empire, century, archaeology |
| 太空 `space` | 宇宙、太阳月亮、地球与大气、航天 | planet, star, orbit, astronaut |

#### 旅行与交通 Travel

| 二级 | 收什么 | 例词 |
|---|---|---|
| 度假与住宿 `holidays` | 度假、旅游业、酒店和其他住宿、露营 | holiday, tourist, hotel, campsite |
| 航空 `air-travel` | 飞机、机场和乘机 | plane, airport, flight, pilot |
| 公交与铁路 `bus-and-train` | 公交、火车和车站 | bus, train, platform, ticket |
| 汽车与道路 `cars-and-roads` | 车辆、驾驶、道路、交通管理和事故 | car, drive, motorway, traffic |
| 水上交通 `water-transport` | 船只和乘船 | ship, ferry, port, sailor |

#### 工作与商业 Work and business

| 二级 | 收什么 | 例词 |
|---|---|---|
| 职业 `jobs` | 职业和职位名称、描述工作 | teacher, engineer, career, job |
| 职场生活 `working-life` | 办公、会议、面试、薪酬和工作条件 | office, meeting, salary, interview |
| 商业 `business` | 经营企业、交易、营销、制造和商界人士 | company, deal, market, factory |
| 金钱与经济 `money` | 钱、付款、银行、金融、经济、价值和赌博 | money, bank, invest, economy, cheap |


牛津的分法有几处和直觉不同，我们照用：
- 「环境」（含自然灾害、能源）在「自然」下；
- 「经济」「银行」在「金钱与经济」下，社交媒体在「电话、邮件与互联网」下；
- 「思维与表达」（牛津叫 Functions）收的是 agree、doubt、prefer、suggest 这类表达态度和判断的词，不是整句的套话。

### 4.4 查漏和补充

**owner 的 19 个话题在新树里的位置：**

| owner 的话题 | 在新树里 |
|---|---|
| 教育 | ★教育（一级） |
| 职场 | 工作与商业 / 职场生活 |
| 科技、科学 | 科学与技术 |
| 环境 | 自然 / 环境 |
| 健康 | 健康 |
| 社会 | 政治与社会 / 社会问题、社会群体 |
| 政法 | 政治与社会 / 政治、法律与司法、犯罪与惩罚、战争与冲突 |
| 经济 | 工作与商业 / 金钱与经济 |
| 媒体 | 文化 / 广播电视与新闻；交流 / 电话、邮件与互联网（社交媒体） |
| 艺术 | 文化 |
| 旅行 | 旅行与交通 |
| **城市** | **牛津没有，补 ★城镇与城市** |
| 自然 | 自然 |
| 生活 | 居家与建筑、休闲、饮食 |
| 情感 | 人物 / 情感 |
| **思维** | **牛津只有观点、怀疑、决定，补 ★思考与记忆** |
| 运动 | 运动 |
| 历史 | 时间与空间 / 历史 |

雅思常考话题都在上面这些里面，没有新的缺口。

**我们自己数据里暴露的缺口**，就是现有挂接里找不到地方的那些义项：

| 补充 | 收什么 | 例子 |
|---|---|---|
| 交流 / ★说话与交谈 | 说、讲、问、答这类动作 | say、tell、ask、reply、chat |
| 概念 / ★描述事物 | 大小、速度、质量、新旧 | big、quick、excellent、ordinary |
| 概念 / ★感官与声音 | 看、听、闻、触和声音 | sound、noise、smell、touch |
| 时间与空间 / ★位置与方向 | 位置和方向（牛津的「太空」指外层空间） | left、north、distance、corner |
| 居家与建筑 / ★工具与维修 | 工具和修理 | hammer、drill、fix、screw |
| 预留三级 ★人工智能、★网络安全 | 补在「计算机」下 | algorithm、malware |

## 5. 场景

### 5.1 模型

- 新增 `scenes` 表，字段有：`id`、`group_id`（所属生活领域）、名称（中英文）、一句话描述、`position`、`image_id`。
- 新增 `scene_topics` 表，记录场景关联哪些话题。
- 场景和话题一样，由策展人通过迁移维护，代理不能新建。
- 新增事实类型 `scene`，主体可以是义项，也可以是短语词条；以后接上口语语块（见 [口语语块方案](2026-11-14-spoken-chunks.md)）。
- 评审标准：**在这个场景里听懂别人或办成事，需要这个义项吗？** 不通过的情况有：只是可能出现、只是联想、属于这个领域但这个场景用不到。
- 每个场景控制在 30–120 个成员。数量少才挑得严。

### 5.2 第一批场景（草案）

| 生活领域 | 场景 |
|---|---|
| 出行 | 机场值机与登机、安检与入境、乘火车地铁、乘公交打车、问路、租车加油、交通事故与被拦车 |
| 住宿 | 酒店入住与退房、投诉房间问题、看房租房、搬家 |
| 餐饮 | 订位、餐厅点餐与结账、咖啡馆点单、点外卖、在家做饭 |
| 购物 | 超市采购、买衣服试穿、网购下单收货、退换货与投诉 |
| 健康 | 预约挂号、看病描述症状、药店买药、看牙、急救、健身房 |
| 学校 | 课堂用语、考试、大学报到选课、写论文 |
| 工作 | 求职面试、开会、电话会议、汇报项目、请假 |
| 金融 | 银行开户转账、申请贷款、报税 |
| 社交 | 初次见面寒暄、邀请与赴约、聚会、约会、打电话、发消息、婚礼、慰问吊唁、节日祝福 |
| 居家 | 日常作息、打扫家务、报修与维修、养宠物、种花园 |
| 公共服务 | 邮局寄件、办证签证、报警 |
| 休闲 | 观光与参观博物馆、看电影看演出、看体育比赛、露营徒步 |

## 6. 现有 147 个二级的去向

| 去向 | 现有二级 |
|---|---|
| 只改成场景 | 租房搬家、餐厅点餐、咖啡馆、超市、商场购物、网购、退换投诉、报警紧急、观光、行李、护照海关、求职面试、会议、聚会庆祝、电话短信、寒暄闲聊、日常作息、公共服务、社区邻里 |
| 拆成场景和话题 | 机场乘机（话题 → 旅行与交通 / 航空）、酒店住宿（→ 度假与住宿）、医院就诊 / 药物药店 / 牙科（→ 健康 / 医疗）、银行（→ 金钱与经济）、问路地图（→ ★位置与方向）、火车地铁和公交出租（→ 公交与铁路）、开车（→ 汽车与道路）、维修 DIY（→ ★工具与维修）、打扫家务（→ 住房与家居）、户外露营（→ 度假与住宿）、课堂（→ 教育 / 中小学） |
| 拆到几个二级 | 情绪 → 人物 / 情感；沟通方式 → ★说话与交谈、讨论与协商、观点与争论；政府政治 → 政治、社会问题 |
| 其余 | 并入对应的二级，比如水果、蔬菜、肉类海鲜 → 饮食 / 食物，球类运动 → 球类与拍类运动 |

## 7. 迁移

- 话题的评审标准变了，所以**现有挂接全部按新标准重审**：
  - 每条挂接按旧话题到新话题的对应关系改名，回到待审（pending），由 reconcile 定时任务重新排队评审；
  - 没有对应新话题的（日常作息）撤回；同一个义项的几条挂接合并到同一个新话题时，只留最早的一条；
  - 之前判「不挂」的 5,385 个义项，按新树重新判，因为大半是没有合适叶子造成的：迁移删除这些判定，并把话题工作项重置。
- 改成场景的那些二级，现有挂接只作为场景的候选，按场景标准重新判，不直接转过去。
- 话题列表不收标签为 taboo、offensive 的义项（义项的标签只有这两种表示粗俗或冒犯）。
- 图片挂在义项上，不受影响。新挂上话题的义项，照旧补图。
- 线上是副本，迁移会在部署时清空它的话题标签。所以本地先迁移、重审完，再合并部署，部署后马上同步，线上没有话题的时间只有几分钟。

## 8. 实现范围

分两步做。

**第一步：话题（本次）**
- `topic` 可以挂类别或话题，换评审标准；评审类别时能看到它下面的话题。
- 迁移：新的两级话题树、旧挂接改名重审、清空公开视图里的话题标签；`public_sense_topics` 加 `specialized`。
- API：`GET /v1/topics/{id}/senses` 先列核心词，再列专门义项，每条带 `specialized`；类别的列表包含挂在类别本身的义项；词条里挂在类别上的标签 `category` 为 null。
- 粗俗义项（taboo、offensive）不进话题列表。
- `docs/design.md` 的话题一节、`spec/topics.feature` 重写；前端话题页把专门义项单独列一组。

**第二步：场景**
- 新增 `scenes`、`scene_topics` 两张表和种子数据，新增 `scene` 事实类型和 `public_scene_members`。
- 新增 `GET /v1/scenes`、`GET /v1/scenes/{id}/members` 和场景页；`docs/design.md` 新增场景一节，新增 `spec/scenes.feature`。

## 9. 待定

- **「概念」「思维与表达」要不要在话题页上露出。** 这两个一级收的是抽象义项，学习者不一定会按它们去浏览。
- **场景要不要分级。** 比如「机场」下面再分值机、安检、登机。草案先做成平的，等成员数量多了再说。
- **重审顺序。** 建议先拿 5 个问题最明显的话题做试点（球类、情绪、沟通方式、开车、恋爱婚姻），看撤回比例，再决定是否全量重审。

## 附录：预留的三级

下面是每个二级下预留的三级，名字照牛津原文；★ 是我们打算补的。现在不建这些三级。

- **动物 / 兽类与其他动物**：Animal behaviour; Animal homes; Animals in general; Dogs; Farm animals; Groups of animals; Parts of animals; Pets; Reptiles and amphibians; Wild mammals; Working animals
- **动物 / 鸟类**：Bird behaviour; Bird homes; Birds; Parts of birds
- **动物 / 鱼类与水生动物**：Fish; Other sea creatures; Parts of fish; Shellfish
- **动物 / 昆虫与小动物**：Insect behaviour; Insect forms; Insect homes; Insects; Other invertebrates; Parts of insects; Spiders, etc.; Worms
- **外貌 / 长相与打扮**：Attractiveness; Beauty products; Body shape; Describing hair; Facial expressions; Facial hair; Posture and movement; Skin; Styling hair
- **外貌 / 身体**：Face; Hands and feet; Inside the body; Mouth and teeth; Parts of the body; Skeleton and muscles
- **外貌 / 服装与时尚**：Accessories; Describing clothes; Footwear; Hats; Items of clothing; Jewellery; Parts of clothing; The fashion world; Wearing clothes
- **外貌 / 颜色与形状**：Colours; Shapes
- **交流 / 语言**：Features of language; Grammar; Language skills; Languages; Phonetics; Punctuation
- **交流 / 电话、邮件与互联网**：Communication devices; Email; Making calls; Phone services; Social media; Text messages; Using the internet; Websites
- **文化 / 美术**：Art equipment; Artwork and techniques; Describing art; Styles of art; The art world
- **文化 / 影视与戏剧**：Elements of a play or film; Film reviews and promotion; Film-making equipment; In the theatre; Making films; People in film and theatre; Producing a play; Showing films; Types of film; Types of play
- **文化 / 文学与写作**：Characters in a story; Describing a story; Elements of a story; Parts of a book; People in publishing; Poetry; Types of story; Types of text; Writing and publishing
- **文化 / 音乐**：Describing music; Listening to music; Live music; Musical instruments; People in the music world; Pieces of music; Producing music; Reading music; Styles of music
- **文化 / 广播电视与新闻**：Broadcasting; Celebrity news; Journalism; Media people; TV and radio shows; The press; Watching TV/Listening to the radio
- **饮食 / 烹饪与用餐**：At the dining table; Diet; Eating out; Kitchen equipment; Meals; Preparing food; Restaurant people; Taste and texture of food; Types of restaurant
- **饮食 / 饮品**：Alcoholic drinks; Drinking; Non-alcoholic drinks; Preparing drinks
- **饮食 / 食物**：Carbohydrates; Dairy and fats; Fruit and nuts; Herbs and spices; Meat, fish and seafood; Sauces; Savoury dishes; Sweets and desserts; Vegetables
- **教育 / 中小学**：Types of school; In school; School life; People in schools; Access to education
- **教育 / 教与学**：Teaching and learning; Subjects and courses
- **教育 / 考试与学历**：Exams and assessment; Degrees
- **教育 / 高等教育**：Universities and colleges; University people
- **思维与表达 / 讨论与协商**：Agreement; Discussion; Ending an agreement; Mediation; Persuasion; Working together
- **思维与表达 / 确定与可能**：Certainty; Doubt; Guessing; Possibility; Probability
- **思维与表达 / 观点与争论**：Expressing agreement; Expressing an opinion; Expressing disagreement; Forming an opinion; Having a disagreement; Making an argument; Matching; Not matching
- **思维与表达 / 许可与义务**：Allowed; Must; Not allowed; Rules
- **思维与表达 / 喜好与决定**：Decide; Dislike; Like; Prefer
- **思维与表达 / 建议**：Advice; Suggestion
- **健康 / 健康与健身**：Exercise; Good health
- **健康 / 疾病与伤痛**：Addiction; Being ill; Injuries; Poor health; Recovering from illness; Types of illness
- **健康 / 医疗**：Complementary medicine; Healthcare; Hospitals; Medical equipment; Medical examinations; Medical staff; Operations
- **健康 / 心理健康**：Mental health care; Mental health problems
- **健康 / 残障**：Living with disability; Types of disability
- **居家与建筑 / 住房与家居**：Buying a home; Furniture; House equipment; Housework; Interior décor; Parts of a house; Renting a home; Rooms in a house; Types of house
- **居家与建筑 / 建筑**：Architectural features; Architectural styles; Building location; Construction; Describing buildings; Historic buildings; Parts of a building; Public buildings; Religious buildings; Types of building
- **居家与建筑 / 花园与园艺**：Gardening; In the garden
- **休闲 / 游戏与玩具**：Ball games; Board games; Card games; Children's games; Computer games; Games in general; Indoor games; Toys
- **休闲 / 爱好与手工**：Activities and interests; Crafts and skills
- **休闲 / 购物**：Departments in stores; Online shopping; Paying for shopping; Shopping in stores; Types of store
- **概念 / 变化与因果**：Cause and effect; Change
- **概念 / 危险与安全**：Dangerous people/things; Involving danger; Preventing danger
- **概念 / 困难与失败**：Accepting failure; Causing difficulty; Causing failure; Involving difficulty; Likely to fail; Resulting in failure; Unsuccessful people/things
- **概念 / 成功**：Achieving success; Acknowledging success; Ambition; Predicting success; Successful people; Successful things
- **人物 / 家庭与关系**：Family background; Friends; Names; Relationships ending; Relatives; Romance
- **人物 / 情感**：Anger; Boredom; Disappointment; Disgust; Embarrassment; Excitement; Fear; Feelings in general; Happiness; Hate; Hunger; Loneliness; Love; Nervous; Showing interest; Surprise; Thirst; Tiredness; Unhappiness; Worry
- **人物 / 人生阶段**：Adults; Babies; Birth; Death; Marriage; Old age; Pregnancy; Raising children; Youth
- **人物 / 个人品质**：Annoying; Brave; Clever; Confident; Cowardly; Dishonest; Energetic; Friendly; Honest; Immoral; Kind; Lazy; Moral; Proud; Selfish; Shy; Skills and qualities; Unpleasant
- **政治与社会 / 政治**：Elections; Government; International relations; Parliament; Political views and systems; Politicians
- **政治与社会 / 法律与司法**：Justice; Legal documents; Legal processes; People in law; The law; The police
- **政治与社会 / 犯罪与惩罚**：Committing crime; Criminals; Prison; Punishment; Solving crime; Types of crime
- **政治与社会 / 战争与冲突**：Peacekeeping; Terrorism; The air force; The armed forces; The army; The navy; War; Weapons
- **政治与社会 / 社会问题**：Drugs; Helping others; Migration; Poverty and famine; Protest; Social justice; Unemployment
- **政治与社会 / 社会群体**：Belonging to society; Gender and sexuality; Race; Rank and status
- **政治与社会 / 宗教与节日**：Beliefs; Divine beings; Holidays and celebrations; Religious ceremonies; Religious holidays and festivals; Religious items; Religious people; Religious places; Religious practices; Religious texts
- **科学与技术 / 生物**：Biology; Genetics
- **科学与技术 / 物理与化学**：Chemistry and chemicals; Energy and physical forces; Materials and properties; Molecules and matter
- **科学与技术 / 数学与计量**：Mathematical terminology; Measurements; Numbers; Types of mathematics
- **科学与技术 / 科学研究**：Branches of science; Data; Experiments; Results; Scientific equipment; Study
- **科学与技术 / 计算机**：Computer hardware; Computer problems; Computer programming; Computer software; Using a computer; ★人工智能; ★网络安全
- **科学与技术 / 工程与机器**：Branches of engineering; Electronics; How machines work; Machines and devices
- **运动 / 球类与拍类运动**：American football; Ball sports in general; Baseball; Basketball; Cricket; Football; Golf; Other ball sports; Rugby; Tennis
- **运动 / 水上运动**：Boating; Diving; Swimming; Water sports
- **运动 / 冰雪运动**：Winter sports
- **运动 / 格斗运动**：Combat sports
- **运动 / 田径与其他运动**：Athletics; Cycling; Equine sports; Extreme sports; Other sports; Pool and snooker
- **自然 / 地理**：Coastlines and the sea; Countries and continents; Describing geographic regions; Mountains and valleys; Other geographic features; Rivers and lakes
- **自然 / 天气**：Describing weather; Rain; Sky; Snow and ice; Temperature; The atmosphere; Wind
- **自然 / 环境**：Climate change; Conservation; Natural disasters; The power industry; Waste and pollution
- **自然 / 植物**：Plants; Trees
- **自然 / 农业**：Animal farming; Farm people; Growing crops; On the farm
- **时间与空间 / 时间**：Dates; Days; Months; Time expressions; Time periods; Time zones; Times of day; Times of year
- **时间与空间 / 历史**：Events in history; Historical records; Objects in history; People in history; Periods in history; Studying history
- **时间与空间 / 太空**：Space travel; The Earth and the atmosphere; The sun and the moon; The universe
- **旅行与交通 / 度假与住宿**：Camping; Holiday accommodation; Holidays in general; Staying in a hotel; The tourist industry; Types of holiday/vacation
- **旅行与交通 / 航空**：Aircraft; Airports; Parts of a plane; People in air travel; Plane travel
- **旅行与交通 / 公交与铁路**：Railway tracks and stations; Train and bus travel; Trains
- **旅行与交通 / 汽车与道路**：Controlling traffic; Driving; Motoring problems and accidents; On the road; Parts of a car; People in motoring; The car industry; Types of road; Types of vehicle
- **旅行与交通 / 水上交通**：Parts of boats; People in sea travel; Travelling by boat; Types of boat
- **工作与商业 / 职业**：Describing jobs; Job titles; Jobs and professions
- **工作与商业 / 职场生活**：Business meetings; Describing work; Job interviews; Office life; Pay and conditions at work
- **工作与商业 / 商业**：Business deals; Business people; Manufacturing; Marketing; Running a business
- **工作与商业 / 金钱与经济**：Banking; Buying and selling; Economic trends; Finance; Gambling; Payments; The economy; Value
