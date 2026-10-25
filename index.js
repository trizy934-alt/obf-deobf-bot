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
const luaparse = require('luaparse');

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.DISCORD_TOKEN;
const MAX_INPUT = 512 * 1024;

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN environment variable.');

// Render health check
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'obf-deobf-advisor' }));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bot is running');
});

server.listen(PORT, '0.0.0.0', () => console.log(`[WEB] Listening on ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  const command = new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('تحليل سكربت مشفر وإعطاء تقرير ونصائح للفك')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('الصق الكود المشفر هنا (اختياري)')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('file')
        .setDescription('ارفع ملف مشفر هنا')
        .setRequired(false));

  await client.application.commands.set([command]);
  console.log('[BOT] Commands registered.');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'analyze') return;

  await interaction.deferReply();

  try {
    const text = interaction.options.getString('code');
    const file = interaction.options.getAttachment('file');

    if (!text && !file) return interaction.editReply('❌ أدخل الكود أو ارفع ملفاً.');
    if (text && file) return interaction.editReply('❌ اختر الكود أو الملف، وليس الاثنين.');

    let source = '';

    if (file) {
      if (file.size > MAX_INPUT) return interaction.editReply('❌ الحد الأقصى للملف 512KB.');
      const res = await fetch(file.url);
      if (!res.ok) return interaction.editReply('❌ فشل تحميل الملف.');
      source = await res.text();
    } else {
      source = text;
    }

    if (!source.trim()) return interaction.editReply('❌ الكود فارغ.');

    const report = generateAnalysisReport(source);

    // لو الناتج طويل جداً، هنبعته في ملف
    if (report.length > 1900) {
      const buffer = Buffer.from(report, 'utf8');
      await interaction.editReply({
        content: '✅ التحليل اكتمل! التقرير طويل جداً، خده في ملف:',
        files: [new AttachmentBuilder(buffer, { name: 'analysis_report.txt' })]
      });
    } else {
      const embed = new EmbedBuilder()
        .setTitle('📊 Script Analysis Report')
        .setColor('#00ffcc')
        .setDescription('```\n' + report + '\n```');
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('[ERROR]', err);
    await interaction.editReply('❌ حدث خطأ داخلي. راجع لوج Render.');
  }
});

// دالة تحليل السكربت
function generateAnalysisReport(source) {
  let report = `[ REPORT START ]\n`;
  report += `Input size: ${Buffer.byteLength(source, 'utf8')} bytes\n\n`;

  // 1. التحليل النصي (Static)
  report += `=== 1. STATIC ANALYSIS ===\n`;
  const lines = source.split('\n');
  let foundLoadstring = false;
  let foundStringChar = false;
  let foundB64 = false;
  let foundHex = false;

  lines.forEach((line, i) => {
    if (line.includes('loadstring(')) {
      foundLoadstring = true;
      report += `[!] Found 'loadstring' on line ${i + 1}:\n    ${line.trim().substring(0, 100)}...\n`;
    }
    if (line.includes('string.char(')) {
      foundStringChar = true;
      report += `[!] Found 'string.char' on line ${i + 1}:\n    ${line.trim().substring(0, 100)}...\n`;
    }
    if (/[a-zA-Z0-9+/]{50,}={0,2}/.test(line)) {
      foundB64 = true;
      report += `[!] Potential Base64 string on line ${i + 1}.\n`;
    }
    if (/\\x([0-9a-fA-F]{2})/.test(line)) {
      foundHex = true;
      report += `[!] Potential Hex escapes on line ${i + 1}.\n`;
    }
  });

  if (!foundLoadstring && !foundStringChar && !foundB64 && !foundHex) {
    report += `[-] No obvious static obfuscation markers found.\n`;
  }

  // 2. تحليل AST
  report += `\n=== 2. AST PARSING ===\n`;
  try {
    const ast = luaparse.parse(source, { luaVersion: '5.3', comments: false });
    report += `[+] AST parsed successfully. Source is valid Lua/Luau.\n`;
    report += `[>] This means the script is syntactically correct.\n`;
  } catch (e) {
    report += `[-] AST parsing failed: ${e.message}\n`;
    report += `[>] This means the script has syntax errors OR uses custom VM opcodes.\n`;
  }

  // 3. إعطاء تعليمات للفك
  report += `\n=== 3. HOW TO DECRYPT (MANUAL STEPS) ===\n`;
  if (foundLoadstring) {
    report += `STEP 1: Locate the 'loadstring' function in the file.\n`;
    report += `STEP 2: The code inside it is often an obfuscated payload.\n`;
    report += `STEP 3: Replace 'loadstring(X)' with 'print(X)' to see the code.\n`;
    report += `STEP 4: Run it in a safe environment to inspect the output.\n`;
  }
  if (foundStringChar) {
    report += `[>] Use a 'string.char decoder' online to convert these numbers back to text.\n`;
  }
  if (foundB64) {
    report += `[>] Use a Base64 decoder on the long strings to reveal the hidden code.\n`;
  }
  if (!foundLoadstring && !foundStringChar && !foundB64) {
    report += `[-] This script seems heavily obfuscated (VM-based like Matcha/Luraph).\n`;
    report += `[>] You cannot decode this manually. Use an API service like Luraph or Moonsec.\n`;
  }

  report += `\n[ REPORT END ]`;
  return report;
}

client.on('error', err => console.error('[DISCORD ERROR]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED]', err));

client.login(TOKEN);
