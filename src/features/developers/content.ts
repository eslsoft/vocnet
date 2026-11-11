// The guide's prose in each language the site speaks. Code samples are built from the live origin
// in the guide itself, so they are the same in every language.

export interface GuideText {
  title: string
  lead: string
  toc: string
  sections: {
    quickstart: { title: string; body: string; baseUrl: string }
    auth: { title: string; body: string }
    limits: { title: string; body: string }
    language: { title: string; body: string; note: string }
    domain: { title: string; body: string }
    pagination: { title: string; body: string }
    caching: { title: string; body: string; documents: string; lists: string }
    errors: { title: string; body: string; meaning: string; codes: Record<string, string> }
    feedback: { title: string; body: string }
    endpoints: { title: string; body: string }
    reference: { title: string; body: string; scalar: string; openapi: string }
  }
  endpoints: Record<string, { title: string; body: string }>
  tryIt: {
    title: string
    send: string
    sending: string
    status: string
    time: string
    headers: string
    body: string
    matches: string
    mismatch: string
    notJson: string
    readOnly: string
    params: string
  }
}

const zh: GuideText = {
  title: '开发者指南',
  lead: 'Vocnet 的公共 API 是一部学习词典，也是一份数据源：每条内容都是经过审阅的事实，用普通的 HTTPS GET 读取，返回 snake_case JSON。',
  toc: '目录',
  sections: {
    quickstart: {
      title: '快速开始',
      body: '所有读取都在同一个基础地址下，无需注册或密钥。下面这条命令返回 animal 的完整词条，带中文翻译：',
      baseUrl: '基础地址',
    },
    auth: {
      title: '认证',
      body: '读取 /v1 不需要任何凭据。提交事实、领取工作等写操作属于 /manage/v1，只对持有 vn_agent_ 密钥的智能体和管理员开放，不在本指南范围内。',
    },
    limits: {
      title: '速率限制',
      body: '每个客户端地址每分钟最多 120 次读取；POST /v1/feedback 每分钟最多 10 次。超出时返回 429，错误码 rate_limited，并带 Retry-After 头（秒）。请在等待后重试，不要立即重放。',
    },
    language: {
      title: '语言：?lang=',
      body: '翻译和话题名称使用 ?lang= 指定的语言（BCP 47 标签，如 zh 或 zh-CN）；没有 ?lang= 时按 Accept-Language 协商。响应里的 lang 字段说明实际使用的语言；为 null 时省略翻译。',
      note: 'lang=all 只用于 GET /v1/entries/{lemma} 和 GET /v1/senses/{id}，此时翻译按语言标签分组；列表接口只接受单一语言。繁体标签（zh-Hant、zh-TW）不会读取简体内容。',
    },
    domain: {
      title: '专业分类：?domain=',
      body: '日常层是学习者使用的类别：dog 是一种 animal，也是一种 pet。?domain=biology 或 ?domain=medicine 会在日常层旁边加上该学科的上位词（dog 是一种 canine、mammal），每条都带 domain 字段。可用于词条、义项和成员列表。',
    },
    pagination: {
      title: '分页',
      body: '列表返回 { items, next_cursor }。limit 取 1–100，默认 20；把上一页的 next_cursor 原样作为 cursor 传回即可取下一页，next_cursor 为 null 表示没有更多。游标是不透明字符串，不要自己构造。',
    },
    caching: {
      title: '缓存',
      body: '响应可以被缓存，且都按 Accept-Language 区分（Vary: Accept-Language）。',
      documents:
        '词条、义项和词形文档带 ETag 和 Cache-Control: public, no-cache：每次使用前重新验证，带上 If-None-Match 时，未变化的文档返回 304 且没有响应体。',
      lists: '列表和搜索带 Cache-Control: public, max-age=5，五秒内可直接复用。',
    },
    errors: {
      title: '错误',
      meaning: '含义',
      body: '所有错误都是同一个结构，code 是稳定的，可以在代码里分支；message 面向人阅读，可能会变。',
      codes: {
        invalid_request: '参数不合法，例如 limit 超出范围或 lang=all 用在列表上。',
        invalid_cursor: 'cursor 不是本接口返回的 next_cursor。',
        not_found: '没有这个词条、义项、词形或话题。查找是精确匹配，不做模糊或词干回退。',
        rate_limited: '超出速率限制；按 Retry-After 等待后重试。',
        internal_error: '服务端异常；稍后重试。',
      },
    },
    feedback: {
      title: '反馈',
      body: '发现词条、义项或事实有误？POST /v1/feedback 提交一条反馈，目标必须是公开可见的。智能体会领取并修正它。',
    },
    endpoints: {
      title: '接口',
      body: '每个接口都可以直接在这里试：修改参数后发送，浏览器会请求真实的 API，并按共享的数据契约校验响应。',
    },
    reference: {
      title: '完整参考',
      body: '每个字段的定义都在 OpenAPI 文档里，交互式参考由它生成。',
      scalar: '打开 API 参考（/docs）',
      openapi: '下载 OpenAPI 文档（/openapi.json）',
    },
  },
  endpoints: {
    'get-entry': {
      title: '获取词条',
      body: '按精确的词头返回完整词条：发音、音节、词频、构词、按词性分组的义项（释义、翻译、例句、搭配、关系、话题）和短语。只有已发布的事实会出现。?include=review 附上每条事实的置信度。',
    },
    search: {
      title: '搜索',
      body: '先返回完全匹配的词头，再返回以 q 开头的词头，然后是释义、所选语言的翻译和例句中包含 q 的词条。支持中文（如 银行）。不做拼写纠正和词干化。',
    },
    'list-entries': {
      title: '列出词条',
      body: '按词头或词频列出词条摘要，可按 CEFR 级别（level=A1,A2）、词性和话题过滤。',
    },
    'get-form': { title: '按词形查找', body: '找出某个屈折形式或变体（如 birds、went）属于哪些词条。' },
    'get-sense': { title: '获取义项', body: '返回一个义项，形状与词条中的义项一致，并附上所属词条的摘要。' },
    'list-members': {
      title: '类别成员',
      body: '把义项当作类别，返回所有上位词链通向它的义项（animal 的成员有 dog、cat，以及经由 bird 的每种鸟），每个只出现一次，depth 为最近的层级，近的在前。',
    },
    topics: { title: '话题分类', body: '返回全部类别及其叶子话题；只有叶子话题会标注到义项上。' },
    'topic-senses': {
      title: '话题下的义项',
      body: '返回标注了该话题的已发布义项；传入类别时包含其所有叶子话题。可按 lemma、frequency 或 level 排序。',
    },
    sources: {
      title: '数据来源',
      body: '词频和 CEFR 数据来自外部数据集。展示这些数据时，请同时展示这里给出的 attribution。',
    },
    feedback: {
      title: '提交反馈',
      body: '报告词条、义项或事实的问题。target_type 为 entry、sense 或 fact，target_id 为其 id。这是写操作，所以这里只给出示例，不会直接发送。',
    },
  },
  tryIt: {
    title: '试一试',
    send: '发送请求',
    sending: '发送中…',
    status: '状态',
    time: '耗时',
    headers: '响应头',
    body: '响应体',
    matches: '符合数据契约',
    mismatch: '不符合数据契约',
    notJson: '响应不是 JSON。',
    readOnly: '这是写操作，复制命令到终端中运行。',
    params: '参数',
  },
}

const en: GuideText = {
  title: 'Developer guide',
  lead: 'The Vocnet public API is a learner’s dictionary and a data source: every item is a reviewed fact, read with a plain HTTPS GET as snake_case JSON.',
  toc: 'Contents',
  sections: {
    quickstart: {
      title: 'Quick start',
      body: 'Every read lives under one base URL and needs no sign-up or key. This returns the whole entry for animal with Chinese translations:',
      baseUrl: 'Base URL',
    },
    auth: {
      title: 'Authentication',
      body: 'Reads under /v1 need no credential. Writes such as submitting facts or claiming work belong to /manage/v1, open only to agents with a vn_agent_ key and to admins, and are outside this guide.',
    },
    limits: {
      title: 'Rate limits',
      body: 'Each client address may read 120 times a minute, and POST /v1/feedback 10 times a minute. Past that the API answers 429 with the code rate_limited and a Retry-After header in seconds. Wait that long before retrying.',
    },
    language: {
      title: 'Language: ?lang=',
      body: 'Translations and topic names are in the language of ?lang= (a BCP 47 tag such as zh or zh-CN), else the one Accept-Language negotiates. The response’s lang field says which; when it is null, translations are omitted.',
      note: 'lang=all is accepted only by GET /v1/entries/{lemma} and GET /v1/senses/{id}, and keys translations by language; a list shows one language. Traditional tags (zh-Hant, zh-TW) never read Simplified Chinese.',
    },
    domain: {
      title: 'Specialist layers: ?domain=',
      body: 'The everyday layer holds the categories a learner uses: a dog is a kind of animal and of pet. ?domain=biology or ?domain=medicine adds that taxonomy’s broader terms beside them (dog is a kind of canine and mammal), each marked with its domain. Entries, senses, and member lists take it.',
    },
    pagination: {
      title: 'Pagination',
      body: 'Lists return { items, next_cursor }. limit is 1–100, 20 by default; pass the previous page’s next_cursor back unchanged as cursor for the next page, and null means there is no more. Cursors are opaque; never build one.',
    },
    caching: {
      title: 'Caching',
      body: 'Responses are cacheable and vary by Accept-Language (Vary: Accept-Language).',
      documents:
        'Entry, sense, and form documents carry an ETag and Cache-Control: public, no-cache: revalidate on every use, and send If-None-Match to get a bodiless 304 while the document is unchanged.',
      lists: 'Lists and search carry Cache-Control: public, max-age=5 and stay fresh for five seconds.',
    },
    errors: {
      title: 'Errors',
      meaning: 'Meaning',
      body: 'Every error has one shape. code is stable, so branch on it; message is for people and may change.',
      codes: {
        invalid_request: 'A parameter is invalid, such as a limit out of range or lang=all on a list.',
        invalid_cursor: 'The cursor is not a next_cursor this endpoint returned.',
        not_found: 'No such entry, sense, form, or topic. Lookups are exact: no fuzzy or stemmed fallback.',
        rate_limited: 'The rate limit is used up; wait for Retry-After, then retry.',
        internal_error: 'The server failed; retry later.',
      },
    },
    feedback: {
      title: 'Feedback',
      body: 'Found a wrong entry, sense, or fact? POST /v1/feedback reports it; the target must be publicly visible. Agents claim and correct it.',
    },
    endpoints: {
      title: 'Endpoints',
      body: 'Try each endpoint here: edit the parameters and send, and the browser calls the real API and checks the response against the shared contract.',
    },
    reference: {
      title: 'Full reference',
      body: 'The OpenAPI document defines every field, and the interactive reference is generated from it.',
      scalar: 'Open the API reference (/docs)',
      openapi: 'Download the OpenAPI document (/openapi.json)',
    },
  },
  endpoints: {
    'get-entry': {
      title: 'Get an entry',
      body: 'The whole entry for an exact lemma: pronunciations, syllables, frequency, word formation, senses grouped by part of speech (gloss, translations, examples, collocations, relations, topics), and phrases. Only published facts appear. ?include=review adds each fact’s confidence.',
    },
    search: {
      title: 'Search',
      body: 'The exact lemma first, then lemmas that start with q, then entries whose gloss, translation in the response language, or example holds q. Chinese works (银行). No typo correction or stemming.',
    },
    'list-entries': {
      title: 'List entries',
      body: 'Entry summaries in lemma or frequency order, filtered by CEFR level (level=A1,A2), part of speech, and topic.',
    },
    'get-form': { title: 'Look up a form', body: 'The entries an inflected or variant form (birds, went) belongs to.' },
    'get-sense': {
      title: 'Get a sense',
      body: 'One sense in the shape the entry shows it, with its entry as a summary.',
    },
    'list-members': {
      title: 'Category members',
      body: 'Every sense whose broader terms lead up to this one (animal: dog, cat, and each bird through bird), each once at its nearest depth, nearest first.',
    },
    topics: { title: 'Topic taxonomy', body: 'Every category with its leaf topics; only leaves tag senses.' },
    'topic-senses': {
      title: 'Senses of a topic',
      body: 'The published senses tagged with a topic, or with any topic of a category, by lemma, frequency, or level.',
    },
    sources: {
      title: 'Data sources',
      body: 'Frequency and CEFR data come from external datasets. Show each source’s attribution wherever you show its data.',
    },
    feedback: {
      title: 'Submit feedback',
      body: 'Report a problem with an entry, a sense, or a fact: target_type is entry, sense, or fact, and target_id its id. It writes data, so the guide shows the request without sending it.',
    },
  },
  tryIt: {
    title: 'Try it',
    send: 'Send request',
    sending: 'Sending…',
    status: 'Status',
    time: 'Time',
    headers: 'Headers',
    body: 'Body',
    matches: 'Matches the contract',
    mismatch: 'Does not match the contract',
    notJson: 'The response is not JSON.',
    readOnly: 'This writes data; copy the command into a terminal to run it.',
    params: 'Parameters',
  },
}

export const GUIDE: Record<'zh-CN' | 'en-US', GuideText> = { 'zh-CN': zh, 'en-US': en }
