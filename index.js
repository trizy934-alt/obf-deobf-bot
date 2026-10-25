'use strict';

require('dotenv').config();

const http = require('node:http');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder
} = require('discord.js');

// محرك Lua (Fengari) - عشان نشغل الكود في بيئة وهمية
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
// مكتبة تحليل الكود (Luaparse) - عشان نفهم الكود كنص
const luaparse = require('luaparse');

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.DISCORD_TOKEN;
const MAX_INPUT = 512 * 1024;
const MAX_OUTPUT = 7 * 1024 * 1024;

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');

// Render health check
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'hybrid-deobfuscator' }));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bot is running');
});
server.listen(PORT, '0.0.0.0', () => console.log(`[WEB] Listening on ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  const command = new SlashCommandBuilder()
    .setName('deobfuscate')
    .setDescription('فك تشفير سكربتات Luau (تحليل هجين: نصي + ديناميكي)')
    .addStringOption(opt => opt.setName('code').setDescription('الكود المشفر').setRequired(false))
    .addAttachmentOption(opt => opt.setName('file').setDescription('ارفع ملف .lua / .txt / .deobf').setRequired(false));
  
  await client.application.commands.set([command]);
  console.log('[BOT] Commands registered.');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'deobfuscate') return;

  await interaction.deferReply();

  try {
    let source = '';
    const text = interaction.options.getString('code');
    const file = interaction.options.getAttachment('file');

    if (!text && !file) return interaction.editReply('❌ أدخل الكود أو ارفع ملف.');
    if (text && file) return interaction.editReply('❌ اختر الكود أو الملف، وليس الاثنين.');

    if (file) {
      if (!/\.(lua|luau|txt|deobf)$/i.test(file.name)) return interaction.editReply('❌ امتداد غير مدعوم.');
      if (file.size > MAX_INPUT) return interaction.editReply('❌ الحد الأقصى 512KB.');
      const res = await fetch(file.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return interaction.editReply('❌ فشل تحميل الملف.');
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_INPUT) return interaction.editReply('❌ الملف كبير جداً.');
      source = buffer.toString('utf8');
    } else {
      source = text;
    }

    if (!source.trim()) return interaction.editReply('❌ الملف فارغ.');

    // تشغيل التحليل الهجين
    const result = await hybridDeobfuscate(source);

    if (!result.finalCode) return interaction.editReply('❌ فشل فك التشفير بجميع الطرق.');

    // تجهيز النتيجة
    const outputBuffer = Buffer.from(result.finalCode, 'utf8');
    const reportBuffer = Buffer.from(result.report, 'utf8');

    const embed = new EmbedBuilder()
      .setTitle('✅ Hybrid Deobfuscation Complete')
      .setColor(0x00ffcc)
      .setDescription([
        `**الطريقة الناجحة:** ${result.method}`,
        `**التغييرات:** ${result.changes.length}`,
        `**حجم الناتج:** ${outputBuffer.length} bytes`,
        '',
        'تم استخدام مزيج من التحليل النصي والتنفيذ الديناميكي.'
      ].join('\n'));

    await interaction.editReply({
      embeds: [embed],
      files: [
        new AttachmentBuilder(outputBuffer, { name: 'deobfuscated.lua' }),
        new AttachmentBuilder(reportBuffer, { name: 'report.txt' })
      ]
    });

  } catch (err) {
    console.error('[ERROR]', err);
    await interaction.editReply('❌ حدث خطأ داخلي. راجع لوج Render.');
  }
});

// ==========================================
// محرك التحليل الهجين (Hybrid Engine)
// ==========================================
async function hybridDeobfuscate(input) {
  const report = [];
  let code = input;
  let method = 'فشل';
  const changes = [];

  // 1. المرحلة الأولى: التحليل النصي (Static Analysis)
  report.push('=== Static Analysis Pass ===');
  const staticResult = staticAnalyze(code);
  if (staticResult.changed) {
    code = staticResult.code;
    changes.push(...staticResult.changes);
    report.push('Static transformations applied: ' + staticResult.changes.join(', '));
  } else {
    report.push('No static transformations applied.');
  }

  // 2. المرحلة الثانية: محاولة التحليل النصي باستخدام Luaparse
  report.push('\n=== AST Parsing Pass ===');
  try {
    const ast = luaparse.parse(code, { luaVersion: '5.3', comments: false });
    report.push('AST parsed successfully. Source is valid Lua.');
    // ممكن نستخدم الـ AST عشان نلاقي loadstring أو string.char
    const extracted = extractFromAST(ast);
    if (extracted) {
      changes.push('AST loadstring extraction');
      report.push('Extracted payload from AST: ' + extracted.length + ' bytes');
      code = extracted; // نستخدم الكود المستخرج
    }
  } catch (e) {
    report.push('AST parsing failed: ' + e.message);
  }

  // 3. المرحلة الثالثة: التنفيذ الديناميكي (Dynamic Execution) باستخدام Fengari
  report.push('\n=== Dynamic Execution Pass (Fengari) ===');
  const dynamicResult = executeWithFengari(code);
  if (dynamicResult.success) {
    method = 'Dynamic Execution (Fengari)';
    code = dynamicResult.payload;
    changes.push('Fengari payload capture');
    report.push('Fengari captured payload: ' + code.length + ' bytes');
  } else {
    report.push('Fengari execution failed: ' + dynamicResult.error);
  }

  // 4. المرحلة الرابعة: تنظيف إضافي (لو الكود لسه فيه تشفير)
  report.push('\n=== Final Cleanup Pass ===');
  const finalClean = staticAnalyze(code);
  if (finalClean.changed) {
    code = finalClean.code;
    changes.push(...finalClean.changes);
    report.push('Final cleanup applied.');
  }

  // 5. تجميع التقرير
  const finalReport = [
    '# Hybrid Deobfuscation Report',
    `Input size: ${Buffer.byteLength(input, 'utf8')} bytes`,
    `Output size: ${Buffer.byteLength(code, 'utf8')} bytes`,
    `Method used: ${method}`,
    `Total changes: ${changes.length}`,
    '',
    ...report
  ].join('\n');

  return { finalCode: code, report: finalReport, method, changes };
}

// ---- التحليل النصي (Static Analysis) ----
function staticAnalyze(input) {
  let code = input;
  const changes = [];

  // 1. فك تشفير string.char
  const charResult = decodeStringChar(code);
  if (charResult.changed) { code = charResult.code; changes.push('string.char decode'); }

  // 2. فك تشفير الـ Hex (\x41)
  const hexResult = decodeHexEscapes(code);
  if (hexResult.changed) { code = hexResult.code; changes.push('hex escape decode'); }

  // 3. فك تشفير الـ Decimal (\065)
  const decResult = decodeDecimalEscapes(code);
  if (decResult.changed) { code = decResult.code; changes.push('decimal escape decode'); }

  // 4. استخراج loadstring
  const lsResult = extractLoadstring(code);
  if (lsResult.changed) { code = lsResult.code; changes.push('loadstring extraction'); }

  // 5. إزالة التعليقات
  const commentResult = removeComments(code);
  if (commentResult.changed) { code = commentResult.code; changes.push('comments removed'); }

  return { code, changed: changes.length > 0, changes };
}

function decodeStringChar(source) {
  let changed = false;
  const pattern = /string\s*\.\s*char\s*\(\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*\)/g;
  const code = source.replace(pattern, (orig, args) => {
    const values = args.split(',').map(v => Number(v.trim()));
    if (values.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return orig;
    changed = true;
    return luaQuote(String.fromCharCode(...values));
  });
  return { code, changed };
}

function decodeHexEscapes(source) {
  let changed = false;
  const code = source.replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => {
    changed = true;
    return String.fromCharCode(parseInt(hex, 16));
  });
  return { code, changed };
}

function decodeDecimalEscapes(source) {
  let changed = false;
  const code = source.replace(/\\(\d{1,3})/g, (match, digits) => {
    const n = Number(digits);
    if (n > 255) return match;
    changed = true;
    return String.fromCharCode(n);
  });
  return { code, changed };
}

function extractLoadstring(source) {
  let changed = false;
  const pattern = /\bloadstring\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g;
  const code = source.replace(pattern, (orig, literal) => {
    const value = parseLuaString(literal);
    if (value === null) return orig;
    changed = true;
    return `--[[ Extracted loadstring payload ]]\n${value}\n--[[ End ]]`;
  });
  return { code, changed };
}

function parseLuaString(literal) {
  const quote = literal[0];
  if (literal[literal.length - 1] !== quote) return null;
  let value = literal.slice(1, -1);
  value = value.replace(/\\(n|r|t|0|\\|"|')/g, (_, esc) => {
    const map = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
    return map[esc];
  });
  value = value.replace(/\\(\d{1,3})/g, (match, digits) => {
    const n = Number(digits);
    return n <= 255 ? String.fromCharCode(n) : match;
  });
  return value;
}

function removeComments(source) {
  // إزالة بسيطة للتعليقات (مش هتأثر على النصوص)
  let changed = false;
  const code = source.replace(/--\[\[[\s\S]*?\]\]/g, () => { changed = true; return ''; })
                     .replace(/--[^\n]*/g, () => { changed = true; return ''; });
  return { code, changed };
}

function luaQuote(value) {
  return '"' + value.replace(/[\0-\x1f\\"]/g, char => {
    const map = { '\0': '\\000', '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return map[char] || '\\' + char.charCodeAt(0).toString().padStart(3, '0');
  }) + '"';
}

// ---- استخراج الكود من AST ----
function extractFromAST(ast) {
  // بندور على loadstring في الـ AST
  let extracted = null;
  function visit(node) {
    if (node.type === 'CallExpression' && node.base.name === 'loadstring') {
      if (node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
        extracted = node.arguments[0].value;
      }
    }
    for (const key in node) {
      if (typeof node[key] === 'object' && node[key] !== null) visit(node[key]);
    }
  }
  visit(ast);
  return extracted;
}

// ---- التنفيذ الديناميكي (Fengari) ----
function executeWithFengari(code) {
  try {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    const setupLua = `
      game = { GetService = function(self, name) return { GetPlayers = function() return {} end, LocalPlayer = {} } end }
      workspace = { GetDescendants = function() return {} end }
      Instance = { new = function(c) return { Name = "Fake", IsA = function() return true end, Destroy = function() end, GetChildren = function() return {} end } end }
      Vector3 = { new = function() return {} end }
      CFrame = { new = function() return {} end }
      Color3 = { new = function() return {} end, fromRGB = function() return {} end }
      UDim2 = { new = function() return {} end }
      Enum = { Material = { SmoothPlastic = 1 } }
      syn = { protect_gui = function() end }
      getgc = function() return {} end
      hookmetamethod = function() return function() end end
      getnamecallmethod = function() return "" end
      checkcaller = function() return true end
      warn = function(msg) print("[WARN] " .. tostring(msg)) end
      getfenv = function() return _G end
      setfenv = function() end
      _captured = nil
      loadstring = function(code)
        _captured = code
        return function() end
      end
    `;

    if (lauxlib.luaL_dostring(L, to_luastring(setupLua)) !== lua.LUA_OK) {
      return { success: false, error: 'Setup failed: ' + to_jsstring(lua.lua_tostring(L, -1)) };
    }

    const status = lauxlib.luaL_dostring(L, to_luastring(code));
    if (status !== lua.LUA_OK) {
      // مش شرط يكون فشل، ممكن يكون السكربت ضرب بعد ما مسكنا الكود
      const err = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_getglobal(L, to_luastring("_captured"));
      let captured = null;
      if (lua.lua_isstring(L, -1)) captured = to_jsstring(lua.lua_tostring(L, -1));
      lua.lua_close(L);
      if (captured) return { success: true, payload: captured };
      return { success: false, error: err };
    }

    lua.lua_getglobal(L, to_luastring("_captured"));
    let captured = null;
    if (lua.lua_isstring(L, -1)) captured = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_close(L);

    if (captured) return { success: true, payload: captured };
    return { success: false, error: 'No payload captured.' };
  } catch (e) {
    return { success: false, error: 'Fengari crash: ' + e.message };
  }
}

client.on('error', err => console.error('[DISCORD ERROR]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED]', err));

client.login(TOKEN);
