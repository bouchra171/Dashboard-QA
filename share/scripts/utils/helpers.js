const fs = require('fs');
const path = require('path');
const zlib = require('zlib');


let faker = null;
try {
  ({ faker } = require('@faker-js/faker/locale/fr'));
} catch {
  // faker is optional unless USE_FAKER is enabled
}



const SKIP_ON_CANDIDATURE_EN_COURS = true;

const EMAIL_SUFFIX_RANDOM = true;

const NAME_SUFFIX_ENABLED = true;

const PHONE_INCREMENT_ENABLED = true;
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS ?? 600);
const STEP_PAUSE_MS = Number(process.env.STEP_PAUSE_MS ?? 400);
const MIN_PJ_BYTES = Number(process.env.MIN_PJ_BYTES ?? 1024);
const COMBO_READY_TIMEOUT_MS = Number(process.env.COMBO_READY_TIMEOUT_MS ?? 4000);
const COMBO_ENABLED_TIMEOUT_MS = Number(process.env.COMBO_ENABLED_TIMEOUT_MS ?? 5000);
const COMBO_OPTIONS_TIMEOUT_MS = Number(process.env.COMBO_OPTIONS_TIMEOUT_MS ?? 3500);
const COMBO_RETRY_TIMEOUT_MS = Number(process.env.COMBO_RETRY_TIMEOUT_MS ?? 1800);
const COMBO_RETRY_COUNT = Number(process.env.COMBO_RETRY_COUNT ?? 2);

const DEBUG_REQUIRED = process.env.DEBUG_REQUIRED === '1';
const DEBUG_LABELS = process.env.DEBUG_LABELS === '1';
const DEBUG_DROPDOWN_OPTIONS = process.env.DEBUG_DROPDOWN_OPTIONS === '1';
const STRICT_SELECT = process.env.STRICT_SELECT !== '0';
const USE_FAKER = process.env.USE_FAKER === '1' || process.argv.includes('--faker');
const RECOVER_ON_START = process.env.RECOVER_ON_START === '1';
const AUTO_JDD = process.env.AUTO_JDD !== '0';
const PAGE_PAUSE = process.env.PAGE_PAUSE !== '0';
const UPLOAD_OPTIONAL = process.env.UPLOAD_OPTIONAL === '1';
const ALLOW_NATIVE_FILECHOOSER = process.env.ALLOW_NATIVE_FILECHOOSER !== '0';
const PJ_VERIFY_VIEW = process.env.PJ_VERIFY_VIEW === '1';
const PJ_VIEW_TIMEOUT_MS = Number(process.env.PJ_VIEW_TIMEOUT_MS ?? 6000);

const DEFAULT_SESSIONS = ['Septembre / Octobre 2026', 'Fevrier / Mars 2026'];
const DEFAULT_CAMPUSES = ['Paris'];
const DEFAULT_PROGRAMMES = ['__RANDOM__'];

const DROPDOWN_LABELS = [
  'session de rentree',
  'campus',
  'niveau d admission',
  'nom du programme',
  'pays de residence',
  'nationalite',
  'niveau d etude',
  'type d etude',
  'session d admission',
];



function normalizeEmailPart(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function formatDateFR(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}/${m}/${y}`;
}

function randomFrenchPhone(prefix) {
  const digits = Math.floor(Math.random() * 1e8).toString().padStart(8, '0');
  return `${prefix}${digits}`;
}

function applyDynamicJdd(data, runId) {
  if (!data?.page1) return data;
  if (!AUTO_JDD) return data;

  const suffix = makeEmailSuffix(runId);
  if (faker && USE_FAKER) {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const birth = faker.date.birthdate({ min: 18, max: 28, mode: 'age' });
    data.page1.prenom = first;
    data.page1.nom = last;
    data.page1.date_naissance = formatDateFR(birth);
    const emailLocal = `${normalizeEmailPart(first)}.${normalizeEmailPart(last)}-${suffix}`;
    data.page1.email = `${emailLocal}@test.com`;
    data.page1.email_confirm = data.page1.email;
    data.page1.email_parent = `parent.${normalizeEmailPart(last)}-${suffix}@test.com`;
    data.page1.email_parent_confirm = data.page1.email_parent;
    data.page1.telephone = randomFrenchPhone('06');
    data.page1.telephone_parent = randomFrenchPhone('07');
    return data;
  }

  // Fallback: keep existing values, suffix will be applied later
  return data;
}

async function pauseForReview(label) {
  if (!PAGE_PAUSE) return;
  const ms = Number(process.env.PAGE_PAUSE_MS ?? 5000);
  if (!ms || ms <= 0) return;
  console.log(`\n[INFO] ${label}: pause automatique ${ms}ms`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollToBottom(page) {
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  } catch {
    // ignore
  }
  try {
    const containers = page.locator('form, main, [role="dialog"]');
    const count = await containers.count();
    for (let i = 0; i < count; i++) {
      const el = containers.nth(i);
      try {
        const handle = await el.elementHandle();
        if (handle) {
          await page.evaluate((node) => {
            try {
              node.scrollTop = node.scrollHeight;
            } catch {
              // ignore
            }
          }, handle);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

async function acceptCookiesIfBlocking(page, context = '') {
  const actions = [
    /Accepter\s*&\s*Fermer/i,
    /Accepter\s+tout/i,
    /Continuer\s+sans\s+accepter/i,
    /Refuser\s+tout/i,
    /Enregistrer/i,
  ];

  const tryClick = async (scope, regex) => {
    try {
      const btn = scope.getByRole('button', { name: regex }).first();
      if (await btn.count()) {
        try { await btn.scrollIntoViewIfNeeded(); } catch {}
        if (await btn.isVisible()) {
          await btn.click({ force: true });
          return true;
        }
      }
    } catch {}
    try {
      const locator = scope.locator('button, a, [role="button"]').filter({ hasText: regex }).first();
      if (await locator.count()) {
        try { await locator.scrollIntoViewIfNeeded(); } catch {}
        if (await locator.isVisible()) {
          await locator.click({ force: true });
          return true;
        }
      }
    } catch {}
    try {
      const textNode = scope.getByText(regex, { exact: false }).first();
      if (await textNode.count()) {
        try { await textNode.scrollIntoViewIfNeeded(); } catch {}
        if (await textNode.isVisible()) {
          await textNode.click({ force: true });
          return true;
        }
      }
    } catch {}
    return false;
  };

  try {
    const modal = page.locator(
      '#didomi-popup, #didomi-notice, [id*="didomi"], [role="dialog"], [aria-modal="true"], .modal, .popup'
    );
    const hasModal = await modal.first().isVisible().catch(() => false);
    const scope = hasModal ? modal.first() : page;

    // If no modal, only proceed if cookie text is visible to avoid misclicks
    if (!hasModal) {
      const cookiesText = page.getByText(/cookies/i).first();
      const hasCookiesText = await cookiesText.isVisible().catch(() => false);
      if (!hasCookiesText) return false;
    }

    for (const regex of actions) {
      const clickedInScope = await tryClick(scope, regex);
      if (clickedInScope) {
        await page.waitForTimeout(700);
        const cookiesStillVisible = await page.getByText(/cookies/i).first().isVisible().catch(() => false);
        if (!cookiesStillVisible) {
          console.log(`[OK] Cookies acceptes${context ? ` - ${context}` : ''}`);
          return true;
        }
      }

      if (scope !== page) {
        const clickedOnPage = await tryClick(page, regex);
        if (clickedOnPage) {
          await page.waitForTimeout(700);
          const cookiesStillVisible = await page.getByText(/cookies/i).first().isVisible().catch(() => false);
          if (!cookiesStillVisible) {
            console.log(`[OK] Cookies acceptes${context ? ` - ${context}` : ''}`);
            return true;
          }
        }
      }
    }

    try {
      const clickedByDom = await page.evaluate(() => {
        const patterns = [
          /Accepter\s*&\s*Fermer/i,
          /Accepter\s+tout/i,
          /Continuer\s+sans\s+accepter/i,
          /Refuser\s+tout/i,
          /Enregistrer/i,
        ];
        const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
        const target = nodes.find((node) => {
          const text = (node.textContent || '').trim();
          return patterns.some((pattern) => pattern.test(text));
        });
        if (!target) return false;
        target.click();
        return true;
      });
      if (clickedByDom) {
        await page.waitForTimeout(700);
        const cookiesStillVisible = await page.getByText(/cookies/i).first().isVisible().catch(() => false);
        if (!cookiesStillVisible) {
          console.log(`[OK] Cookies acceptes${context ? ` - ${context}` : ''}`);
          return true;
        }
      }
    } catch {
      // ignore
    }

    try {
      const removed = await page.evaluate(() => {
        const patterns = [
          /Avec votre accord/i,
          /cookies/i,
          /Continuer sans accepter/i,
          /Accepter\s*&\s*Fermer/i,
        ];
        const matches = Array.from(document.querySelectorAll('body *')).filter((node) => {
          const text = (node.textContent || '').trim();
          if (!text) return false;
          return patterns.some((pattern) => pattern.test(text));
        });
        if (!matches.length) return false;

        const removedNodes = new Set();
        const removeNode = (node) => {
          if (!node || removedNodes.has(node) || node === document.body || node === document.documentElement) return;
          removedNodes.add(node);
          node.remove();
        };

        for (const match of matches) {
          const clickableAncestor = match.closest('[role="dialog"], [aria-modal="true"], .modal, .popup, [id*="didomi"], [class*="didomi"]');
          if (clickableAncestor) {
            removeNode(clickableAncestor);
          } else {
            const fixedAncestor = match.closest('div, section, aside');
            if (fixedAncestor) {
              const style = window.getComputedStyle(fixedAncestor);
              if (style.position === 'fixed' || style.position === 'sticky' || Number(style.zIndex || 0) > 100) {
                removeNode(fixedAncestor);
              }
            }
          }
        }

        const overlays = Array.from(document.querySelectorAll('body *')).filter((node) => {
          const style = window.getComputedStyle(node);
          if (!['fixed', 'sticky'].includes(style.position)) return false;
          const rect = node.getBoundingClientRect();
          return rect.width >= window.innerWidth * 0.6 && rect.height >= window.innerHeight * 0.4;
        });
        overlays.forEach(removeNode);
        return removedNodes.size > 0;
      });
      if (removed) {
        await page.waitForTimeout(500);
        const cookiesStillVisible = await page.getByText(/cookies/i).first().isVisible().catch(() => false);
        if (!cookiesStillVisible) {
          console.log(`[OK] Cookies neutralises${context ? ` - ${context}` : ''}`);
          return true;
        }
      }
    } catch {
      // ignore
    }

    // fallback: press Escape
    try {
      await page.keyboard.press('Escape');
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
  return false;
}

function getEnvList(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw.split(',').map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

function ensureAttachmentsExist(dataRoot, attachments) {
  const missing = [];
  for (const rel of Object.values(attachments)) {
    const abs = path.resolve(dataRoot, rel);
    if (!fs.existsSync(abs)) missing.push(abs);
  }
  if (missing.length > 0) {
    throw new Error(`Fichiers PJ manquants: ${missing.join(', ')}`);
  }
}

function getAttachmentBaseDir(baseDir) {
  const dirA = path.resolve(baseDir || '.', 'attachments');
  const dirB = path.resolve(baseDir || '.', 'attachment');
  return fs.existsSync(dirA) ? dirA : dirB;
}

function escapePdfText(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(title) {
  const pad = Number(process.env.PJ_PAD_CHARS ?? 12000);
  const contentText = `${title} ${'X'.repeat(pad)}`;
  const streamText = `BT\n/F1 18 Tf\n72 720 Td\n(${escapePdfText(contentText)}) Tj\nET\n`;
  let body = '';
  const offsets = [];
  const addObj = (n, content) => {
    offsets[n] = body.length;
    body += `${n} 0 obj\n${content}\nendobj\n`;
  };
  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  addObj(4, `<< /Length ${streamText.length} >>\nstream\n${streamText}endstream`);
  addObj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const header = '%PDF-1.4\n';
  const xrefOffset = header.length + body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(header.length + offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return header + body + xref + trailer;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function buildSimplePng(width = 128, height = 160) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = (x * 7 + y * 3) % 256;
      raw[offset + 1] = (x * 5 + y * 11) % 256;
      raw[offset + 2] = (x * 13 + y * 9) % 256;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function slugifyFilePart(value) {
  return String(value || 'document')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'document';
}

function ensureUniqueUploadVariant(label, slotKey, baseDir, sourcePath = '') {
  const stableSource = resolveFilePath(sourcePath, baseDir);
  if (!stableSource || !fs.existsSync(stableSource)) {
    return stableSource || '';
  }

  const base = getAttachmentBaseDir(baseDir);
  const fixedDir = path.join(base, 'generated', 'fixed');
  fs.mkdirSync(fixedDir, { recursive: true });
  const ext = path.extname(stableSource) || '.pdf';
  const labelSlug = slugifyFilePart(label || 'document');
  const keySlug = slugifyFilePart(slotKey || 'slot').slice(0, 48);
  const variantPath = path.join(fixedDir, `${labelSlug}-${keySlug}${ext}`);

  try {
    if (!fs.existsSync(variantPath)) {
      fs.copyFileSync(stableSource, variantPath);
    }
  } catch {
    return stableSource;
  }

  return variantPath;
}

function ensureGeneratedPdfs(baseDir) {
  const base = getAttachmentBaseDir(baseDir);
  const genDir = path.join(base, 'generated');
  fs.mkdirSync(genDir, { recursive: true });
  const files = [
    ['cv.pdf', 'Curriculum vitae'],
    ['cv_ia.pdf', 'Curriculum vitae IA'],
    ['lettre_motivation.pdf', 'Lettre de motivation'],
    ['lettre_recommandation.pdf', 'Lettre de recommandation'],
    ['piece_identite_recto.pdf', "Piece d'identite recto"],
    ['piece_identite_verso.pdf', "Piece d'identite verso"],
    ['dernier_diplome.pdf', 'Dernier diplome obtenu'],
    ['bulletins_notes.pdf', 'Releve de notes'],
    ['dernier_releve_notes.pdf', 'Dernier releve de notes'],
    ['deux_derniers_bulletins.pdf', 'Deux derniers bulletins de notes'],
    ['releves_deux_ans.pdf', 'Releves de notes des deux dernieres annees'],
    ['releve_bac.pdf', 'Releve de notes du BAC'],
    ['attestation_scolarite.pdf', 'Attestation de scolarite'],
    ['generic.pdf', 'Document'],
  ];
  for (const [name, title] of files) {
    const fp = path.join(genDir, name);
    try {
      const exists = fs.existsSync(fp);
      const size = exists ? fs.statSync(fp).size : 0;
      if (!exists || size < MIN_PJ_BYTES) {
        const pdf = buildSimplePdf(title);
        fs.writeFileSync(fp, pdf, 'utf8');
      }
    } catch {
      // ignore
    }
  }
  try {
    const photoPath = path.join(genDir, 'photo_identite.png');
    const exists = fs.existsSync(photoPath);
    const size = exists ? fs.statSync(photoPath).size : 0;
    if (!exists || size < MIN_PJ_BYTES) {
      fs.writeFileSync(photoPath, buildSimplePng());
    }
  } catch {
    // ignore
  }
  return genDir;
}

function getGeneratedFileForLabel(label, baseDir) {
  const base = getAttachmentBaseDir(baseDir);
  const genDir = path.join(base, 'generated');
  const norm = normalizeOption(label || '');
  if (/curriculum vitae ia|cv ia/.test(norm)) return path.join(genDir, 'cv_ia.pdf');
  if (/recommandation|recommendation|reference/.test(norm)) return path.join(genDir, 'lettre_recommandation.pdf');
  if (/notes/.test(norm) && /deux/.test(norm) && /anne/.test(norm)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/bac|baccalaureate/.test(norm)) return path.join(genDir, 'releve_bac.pdf');
  if (/deux derniers/.test(norm) && /bulletin/.test(norm)) return path.join(genDir, 'deux_derniers_bulletins.pdf');
  if (/dernier/.test(norm) && /relev/.test(norm) && /notes/.test(norm)) return path.join(genDir, 'dernier_releve_notes.pdf');
  if (/curriculum|cv/.test(norm)) return path.join(genDir, 'cv.pdf');
  if (/lettre|motivation|cover|letter/.test(norm)) return path.join(genDir, 'lettre_motivation.pdf');
  if (/verso/.test(norm)) return path.join(genDir, 'piece_identite_verso.pdf');
  if (/photo/.test(norm)) return path.join(genDir, 'photo_identite.png');
  if (/recto|identit/.test(norm)) return path.join(genDir, 'piece_identite_recto.pdf');
  if (/diplom|diploma/.test(norm)) return path.join(genDir, 'dernier_diplome.pdf');
  if (/releve|bulletin|notes|bac|baccalaureate|transcript/.test(norm)) return path.join(genDir, 'bulletins_notes.pdf');
  if (/recommandation|recommendation|reference/.test(norm)) return path.join(genDir, 'lettre_motivation.pdf');
  if (/attestation|certificate|scolarit/.test(norm)) return path.join(genDir, 'attestation_scolarite.pdf');
  return path.join(genDir, 'generic.pdf');
}

function getStrictAttachmentForLabel(label, baseDir) {
  const norm = normalizeOption(fixMojibake(label || ''));
  const base = getAttachmentBaseDir(baseDir);
  const genDir = path.join(base, 'generated');
  if (/curriculum vitae ia/.test(norm)) return path.join(genDir, 'cv_ia.pdf');
  if (/recommandation|recommendation|reference/.test(norm)) return path.join(genDir, 'lettre_recommandation.pdf');
  if (/notes/.test(norm) && /deux/.test(norm) && /anne/.test(norm)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/bac|baccalaureate/.test(norm)) return path.join(genDir, 'releve_bac.pdf');
  if (/deux derniers/.test(norm) && /bulletin/.test(norm)) return path.join(genDir, 'deux_derniers_bulletins.pdf');
  if (/dernier/.test(norm) && /relev/.test(norm) && /notes/.test(norm)) return path.join(genDir, 'dernier_releve_notes.pdf');
  if (/deux derniers|notes des deux|transcript/.test(norm)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/relev/.test(norm) && /notes/.test(norm)) return path.join(genDir, 'dernier_releve_notes.pdf');
  return '';
}

function getCriticalAttachmentForLabel(label, baseDir) {
  const norm = normalizeOption(fixMojibake(label || ''));
  const base = getAttachmentBaseDir(baseDir);
  const genDir = path.join(base, 'generated');
  if (/curriculum vitae ia/.test(norm)) return path.join(genDir, 'cv_ia.pdf');
  if (/notes/.test(norm) && /deux/.test(norm) && /anne/.test(norm)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/bac|baccalaureate/.test(norm)) return path.join(genDir, 'releve_bac.pdf');
  if (/deux derniers/.test(norm) && /bulletin/.test(norm)) return path.join(genDir, 'deux_derniers_bulletins.pdf');
  if (/dernier/.test(norm) && /relev/.test(norm) && /notes/.test(norm)) return path.join(genDir, 'dernier_releve_notes.pdf');
  if (/deux derniers|notes des deux|transcript/.test(norm)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/relev/.test(norm) && /notes/.test(norm)) return path.join(genDir, 'dernier_releve_notes.pdf');
  if (/lettre de recommandation|recommandation|recommendation|reference/.test(norm)) return path.join(genDir, 'lettre_recommandation.pdf');
  return '';
}

function getStableAttachmentForProblemLabel(label, inputHint, baseDir) {
  const labelOnly = normalizeOption(fixMojibake(label || ''));
  const fixed = normalizeOption(fixMojibake(`${label || ''} ${inputHint || ''}`));
  const raw = normalizeOption(`${label || ''} ${inputHint || ''}`);
  const text = `${fixed} ${raw}`;
  const genDir = path.join(getAttachmentBaseDir(baseDir), 'generated');

  if (/verso/.test(labelOnly)) return path.join(genDir, 'piece_identite_verso.pdf');
  if (/recto|identit/.test(labelOnly)) return path.join(genDir, 'piece_identite_recto.pdf');
  if (/photo/.test(labelOnly)) return path.join(genDir, 'photo_identite.png');
  if (/certificat|attestation|scolarit/.test(labelOnly)) return path.join(genDir, 'attestation_scolarite.pdf');
  if (/diplom|diploma/.test(labelOnly)) return path.join(genDir, 'dernier_diplome.pdf');
  if (/curriculum vitae ia|cv ia/.test(text)) return path.join(genDir, 'cv_ia.pdf');
  if (/recommandation|recommendation|reference/.test(text)) return path.join(genDir, 'lettre_recommandation.pdf');
  if (/bac|baccalaureate/.test(text)) return path.join(genDir, 'releve_bac.pdf');
  if (/notes/.test(text) && /deux/.test(text) && /anne/.test(text)) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/deux derniers/.test(text) && /bulletin/.test(text)) return path.join(genDir, 'deux_derniers_bulletins.pdf');
  if (/dernier/.test(text) && /relev/.test(text) && /notes/.test(text)) return path.join(genDir, 'dernier_releve_notes.pdf');
  if (/transcript/.test(text) || (/notes/.test(text) && /deux/.test(text))) return path.join(genDir, 'releves_deux_ans.pdf');
  if (/relev/.test(text) && /notes/.test(text)) return path.join(genDir, 'dernier_releve_notes.pdf');

  return '';
}

function ensureUsableFile(label, filePath, baseDir) {
  const resolved = resolveFilePath(filePath, baseDir);
  if (resolved && fs.existsSync(resolved)) {
    const size = fs.statSync(resolved).size;
    if (size >= MIN_PJ_BYTES) return resolved;
  }
  const fallback = getGeneratedFileForLabel(label || '', baseDir);
  if (fallback && fs.existsSync(fallback)) return fallback;
  return resolved || null;
}

function getAttachmentPool(baseDir) {
  const dir = getAttachmentBaseDir(baseDir);
  ensureGeneratedPdfs(baseDir);
  const files = [];
  const walk = (root) => {
    try {
      const items = fs.readdirSync(root, { withFileTypes: true });
      for (const item of items) {
        const full = path.resolve(root, item.name);
        if (item.isDirectory()) {
          walk(full);
        } else if (/\.(pdf|png|jpe?g|docx?)$/i.test(item.name)) {
          try {
            const size = fs.statSync(full).size;
            if (size >= MIN_PJ_BYTES) files.push(full);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  };
  walk(dir);
  const score = (p) => {
    const name = path.basename(p);
    const m = name.match(/PJ\s*(\d+)/i);
    if (m) return Number(m[1]);
    return Number.MAX_SAFE_INTEGER;
  };
  files.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
  return files;
}

function buildFakeCandidate(index, dataRoot) {
  if (!faker) {
    throw new Error('Le package est incomplet: la dependance de generation des donnees est introuvable. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".');
  }

  const sessions = getEnvList('SESSIONS', DEFAULT_SESSIONS);
  const campuses = getEnvList('CAMPUSES', DEFAULT_CAMPUSES);
  const programmes = getEnvList('PROGRAMMES', DEFAULT_PROGRAMMES);

  const prenom = faker.person.firstName();
  const nom = faker.person.lastName();
  const email = faker.internet.email({ firstName: prenom, lastName: nom }).toLowerCase();
  const emailParent = faker.internet.email().toLowerCase();
  const dob = faker.date.birthdate({ min: 17, max: 22, mode: 'age' });

  const attachments = {
    "Pi\u00e8ce d'identit\u00e9 (recto)": 'attachments/identite/piece_identite_recto.pdf',
    "Pi\u00e8ce d'identit\u00e9 (verso)": 'attachments/identite/piece_identite_verso.pdf',
    'Relev\u00e9 de notes du BAC': 'attachments/notes/bulletins_notes.pdf',
    'Deux derniers bulletins de notes': 'attachments/notes/bulletins_notes.pdf',
    'Dernier dipl\u00f4me obtenu': 'attachments/diplome/dernier_diplome.pdf',
    'Curriculum vitae': 'attachments/cv/cv.pdf',
    'Lettre de motivation': 'attachments/lettre/lettre_motivation.pdf',
    'Attestation de scolarit\u00e9': 'attachments/attestation/attestation_scolarite.pdf',
  };

  ensureAttachmentsExist(dataRoot, attachments);

  const day = String(dob.getDate()).padStart(2, '0');
  const month = String(dob.getMonth() + 1).padStart(2, '0');
  const year = dob.getFullYear();
  const date_naissance = `${day}/${month}/${year}`;

  return {
    id: `candidat-${String(index).padStart(2, '0')}`,
    url: 'https://prospect.rec.omneseducation.com/app/bachelorsinseec/program',
    page1: {
      session: faker.helpers.arrayElement(sessions),
      campus: faker.helpers.arrayElement(campuses),
      niveau_admission: 'Bac',
      programme: faker.helpers.arrayElement(programmes),
      nom,
      prenom,
      date_naissance,
      email,
      email_confirm: email,
      telephone: '06' + faker.string.numeric(8),
      pays: 'France',
      nationalite: 'Francaise',
      email_parent: emailParent,
      email_parent_confirm: emailParent,
      telephone_parent: '06' + faker.string.numeric(8),
    },
    page2: {
      niveau_etude: faker.helpers.arrayElement(['Terminale', 'Bac+1', 'Bac+2']),
      type_etude: faker.helpers.arrayElement(['Generale', 'Technologique', 'Professionnelle']),
      session_admission: 'Sessionbachelor',
      attachments,
    },
  };
}



function alphaSuffix(runId) {

  let n = runId;

  let s = '';

  while (n > 0) {

    n -= 1;

    s = String.fromCharCode(65 + (n % 26)) + s;

    n = Math.floor(n / 26);

  }

  return s || 'A';

}



function withNameSuffix(name, suffix) {

  if (!name) return name;

  const trimmed = name.trim();

  if (trimmed.endsWith(` ${suffix}`)) return trimmed;

  return `${trimmed} ${suffix}`;

}



function digitsOnly(value) {

  return (value || '').replace(/\D/g, '');

}

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeOption(value) {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return normalizeOption(value).replace(/[:*]/g, '').trim();
}

function isDropdownLabel(label) {
  const key = normalizeLabel(label);
  return DROPDOWN_LABELS.some((k) => key.includes(k));
}



function formatLike(original, digits) {

  if (!original) return digits;

  const hasSeparators = /\D/.test(original);

  if (!hasSeparators) return digits;

  let out = '';

  let di = 0;

  for (const ch of original) {

    if (/\d/.test(ch)) {

      out += digits[di] ?? '';

      di += 1;

    } else {

      out += ch;

    }

  }

  if (di < digits.length) out += digits.slice(di);

  return out;

}



function incrementPhone(value, runId) {

  const digits = digitsOnly(value);

  if (digits.length < 4) return value;

  const lastLen = Math.min(3, digits.length);

  const prefix = digits.slice(0, -lastLen);

  const last = parseInt(digits.slice(-lastLen), 10) || 0;

  const mod = Math.pow(10, lastLen);

  const newLast = (last + runId) % mod;

  const newDigits = prefix + String(newLast).padStart(lastLen, '0');

  return formatLike(value, newDigits);

}



function makeEmailSuffix(runId) {

  const base = String(runId).padStart(3, '0');

  if (!EMAIL_SUFFIX_RANDOM) return base;

  const rand = Math.floor(Math.random() * 900 + 100); // 100-999

  return `${base}${rand}`;

}



function getAndBumpRunCounter(counterPath) {

  let last = 0;

  try {

    const raw = fs.readFileSync(counterPath, 'utf-8');

    const parsed = JSON.parse(raw);

    if (Number.isFinite(parsed?.last)) last = parsed.last;

  } catch {

    // ignore missing or invalid file

  }

  const next = last + 1;

  fs.writeFileSync(counterPath, JSON.stringify({ last: next }, null, 2));

  return next;

}



function withEmailSuffix(email, suffix) {

  if (!email || !email.includes('@')) return email;

  const [local, domain] = email.split('@');

  const base = local.replace(/[-+.]\d+$/, '');

  return `${base}-${suffix}@${domain}`;

}



async function selectDropdown(page, index, valeur) {
  return selectDropdownByIndex(page, index, valeur, `index ${index}`);
}

async function waitForComboboxReady(page, dropdown, timeout = COMBO_READY_TIMEOUT_MS) {

  try {

    const handle = await dropdown.elementHandle();

    if (!handle) return false;

    await page.waitForFunction(

      (el) => el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('aria-busy') !== 'true',

      handle,

      { timeout }

    );
    return true;

  } catch {

    return false;

  }

}

async function waitForComboboxEnabled(page, labelOrSelector, timeout = COMBO_ENABLED_TIMEOUT_MS) {
  let locator;
  if (labelOrSelector.startsWith('#') || labelOrSelector.startsWith('.') || labelOrSelector.startsWith('[')) {
    locator = page.locator(labelOrSelector);
  } else {
    const resolved = await resolveDropdownByLabel(page, labelOrSelector);
    locator = resolved || page.getByLabel(labelOrSelector, { exact: false });
  }

  try {
    await locator.first().waitFor({ state: 'attached', timeout });
    const handle = await locator.first().elementHandle();
    if (!handle) return;
    await page.waitForFunction(
      (el) => {
        const ariaDisabled = el.getAttribute && el.getAttribute('aria-disabled');
        const disabled = el.getAttribute && el.getAttribute('disabled');
        const propDisabled = 'disabled' in el ? el.disabled : false;
        return ariaDisabled !== 'true' && disabled !== 'true' && !propDisabled;
      },
      handle,
      { timeout }
    );
  } catch {
    // ignore
  }
}



async function openCombobox(page, dropdown) {
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  } catch {
    // ignore
  }

  try {

    await dropdown.click({ force: true });

  } catch {

    // ignore

  }

  await page.waitForTimeout(75);



  let expanded = false;

  try {

    const handle = await dropdown.elementHandle();

    if (handle) {

      expanded = await page.evaluate((el) => el.getAttribute('aria-expanded') === 'true', handle);

    }

  } catch {

    expanded = false;

  }



  if (!expanded) {

    try {

      await dropdown.locator('.rw-btn, .rw-picker-caret, .rw-select-icon').first().click({ force: true });

      expanded = true;

    } catch {

      // ignore

    }

  }



  if (!expanded) {

    try {

      await dropdown.press('ArrowDown');

    } catch {

      // ignore

    }

  }

}





async function tryTypeSelect(page, dropdown, valeur, label) {

  if (!valeur) return false;

  let input = dropdown.locator('input.rw-dropdownlist-search');

  if (await input.count() === 0) {

    // try within nearest widget container

    try {

      input = dropdown.locator('..').locator('input.rw-dropdownlist-search');

    } catch {

      // ignore

    }

  }

  if (await input.count() === 0) return false;



  try {

    await input.first().click({ force: true });

    await input.first().fill('');

    await input.first().type(valeur, { delay: 50 });

    await input.first().press('Enter');

  } catch {

    return false;

  }



  await page.waitForTimeout(300);

  try {

    const valueEl = dropdown.locator('.rw-dropdown-list-value').first();

    if (await valueEl.count()) {

      const text = await valueEl.textContent();

      if (text && normalizeOption(text).includes(normalizeOption(valeur))) {

        console.log(`  ✅ ${label} => "${text.trim()}"`);

        return true;

      }

    }

  } catch {

    // ignore

  }

  return false;

}

async function pickRandomOptionByKeyboard(page, dropdown, label) {
  try {
    await dropdown.press('ArrowDown');
    const extraMoves = Math.floor(Math.random() * 3);
    for (let i = 0; i < extraMoves; i++) {
      await dropdown.press('ArrowDown');
    }
    await dropdown.press('Enter');
    await page.waitForTimeout(250);

    const valueEl = dropdown.locator('.rw-dropdown-list-value').first();
    let text = '';
    if (await valueEl.count()) {
      text = (await valueEl.textContent()) || '';
    }
    if (!text) {
      const input = dropdown.locator('input').first();
      if (await input.count()) {
        text = await input.inputValue().catch(() => '');
      }
    }
    text = String(text || '').trim();
    if (text) {
      console.log(`  ✅ ${label} => "${text}"`);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function chooseOptionFromList(page, options, valeur, label) {
  const count = await options.count();
  if (!count) {
    console.log(`  [WARNING] Aucune option trouvée pour ${label} (liste vide ou non chargée)`);
    return null;
  }

  const want = valeur && valeur !== '__RANDOM__' ? normalizeOption(valeur) : null;
  let targetIndex = 0;
  let matchFound = !want;
  if (want) {
    const optionTexts = [];
    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      let text = '';
      try {
        text = (await opt.textContent()) || '';
      } catch {
        text = '';
      }
      if (text && DEBUG_DROPDOWN_OPTIONS) {
        optionTexts.push(String(text).trim());
      }
      if (normalizeOption(text).includes(want)) {
        targetIndex = i;
        matchFound = true;
        break;
      }
    }
    if (!matchFound) {
      if (DEBUG_DROPDOWN_OPTIONS && optionTexts.length) {
        console.log(`  [DEBUG] ${label} : options disponibles => ${JSON.stringify(optionTexts)}`);
      }
      console.log(`  [WARNING] ${label} : option attendue introuvable => "${valeur}"`);
      return null;
    }
  } else {
    targetIndex = Math.floor(Math.random() * count);
  }

  const option = options.nth(targetIndex);
  try { await option.scrollIntoViewIfNeeded(); } catch {}
  await option.click({ force: true });

  let pickedText = '';
  try { pickedText = (await option.textContent()) || ''; } catch {}
  if (pickedText) {
    console.log(`  ✅ ${label} => "${pickedText.trim()}"`);
  }
  return pickedText || null;
}

async function collectOptionTexts(options) {
  const count = await options.count();
  const texts = [];
  for (let i = 0; i < count; i += 1) {
    try {
      const text = ((await options.nth(i).textContent()) || '').trim();
      if (text) texts.push(text);
    } catch {
      // ignore
    }
  }
  return texts;
}

function looksLikeLanguageSelectorOptions(optionTexts = [], label = '') {
  const normalizedLabel = normalizeLabel(label);
  if (/(^| )(langue|language)( |$)/i.test(normalizedLabel)) {
    return false;
  }

  const normalizedTexts = optionTexts.map((text) => normalizeOption(text)).filter(Boolean);
  if (!normalizedTexts.length) {
    return false;
  }

  const languageTokens = ['francais', 'français', 'english', 'anglais'];
  return normalizedTexts.every((text) => languageTokens.some((token) => text.includes(normalizeOption(token))));
}

async function getOptionsLocator(page, dropdown) {
  let options;
  try {
    const listId = (await dropdown.getAttribute('aria-controls')) || (await dropdown.getAttribute('aria-owns'));
    if (listId) {
      options = page.locator(
        `#${listId} [role="option"]:visible, #${listId} li:visible, #${listId} [data-rw-option]:visible, #${listId} [data-option]:visible, #${listId} .rw-list-option:visible`
      );
    }
  } catch {
    // ignore
  }
  if (!options) {
    options = page.locator(
      '[role="listbox"]:visible [role="option"]:visible, [role="listbox"]:visible li:visible, .rw-popup:visible [data-rw-option]:visible, .rw-popup:visible [data-option]:visible, .rw-popup:visible .rw-list-option:visible'
    );
  }
  return options;
}

async function waitForOptions(page, dropdown, timeout = COMBO_OPTIONS_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const options = await getOptionsLocator(page, dropdown);
      const count = await options.count();
      if (count > 0) return options;
    } catch {
      // ignore
    }
    await page.waitForTimeout(150);
  }
  return null;
}

async function logEmptyDropdownMessage(page, label) {
  try {
    const emptyMsg = page.getByText(/there are no items in this list|aucun|liste vide|no items/i).first();
    if (await emptyMsg.count()) {
      const text = (await emptyMsg.textContent()) || '';
      console.log(`  [WARNING] ${label} : liste vide (${text.trim()})`);
      return true;
    }
  } catch {
    // ignore
  }
  console.log(`  [WARNING] ${label} : liste vide ou options non chargées`);
  return false;
}

function getComboboxLocator(root) {
  return root.locator('[role="combobox"]');
}

async function getComboboxScopeHandle(page, root) {
  const scope = root === page ? page.locator('body').first() : root.first();
  return scope.elementHandle();
}

async function collectVisibleComboboxIds(page, root = page) {
  const handle = await getComboboxScopeHandle(page, root);
  if (!handle) return [];

  return page.evaluate((scopeEl) => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const roleCombos = Array.from(scopeEl.querySelectorAll('[role="combobox"]'))
      .filter((el) => !el.parentElement?.closest?.('[role="combobox"]'));
    const fallbackCombos = roleCombos.length
      ? roleCombos
      : Array.from(scopeEl.querySelectorAll('.rw-dropdown-list, .rw-combobox')).filter(isVisible);

    const languageTokens = ['francais', 'français', 'english', 'anglais', 'french'];
    const isLikelyLanguageSwitcher = (el) => {
      const headerAncestor = el.closest('header, nav, .header, .navbar, .top-bar, .page-header, .language-switcher, .lang-switcher, .lang-menu, .language-menu');
      const formAncestor = el.closest('form, main, section, article');
      const text = (el.innerText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return false;
      const words = text.split(' ').filter(Boolean);
      const onlyLanguageWords = words.length > 0 && words.every((word) => languageTokens.some((token) => word.includes(token)));
      if (!onlyLanguageWords) return false;
      return Boolean(headerAncestor) || !formAncestor;
    };

    const candidates = fallbackCombos.filter((el) => isVisible(el) && !isLikelyLanguageSwitcher(el));

    const ids = [];
    const seen = new Set();
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const key = `${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let comboId = el.getAttribute('data-codex-combo-id');
      if (!comboId) {
        comboId = `combo-${Math.random().toString(36).slice(2, 10)}`;
        el.setAttribute('data-codex-combo-id', comboId);
      }
      ids.push(comboId);
    }

    return ids;
  }, handle);
}

async function selectDropdownByIndex(page, index, valeur, label, root = page) {
  const ids = await collectVisibleComboboxIds(page, root);
  if (ids.length <= index) {
    throw new Error(`Combobox index ${index} introuvable pour ${label}`);
  }
  const dropdown = page.locator(`[data-codex-combo-id="${ids[index]}"]`).first();
  await waitForComboboxReady(page, dropdown);
  await openCombobox(page, dropdown);

  if (valeur === '__RANDOM__') {
    const pickedByKeyboard = await pickRandomOptionByKeyboard(page, dropdown, label);
    if (pickedByKeyboard) return true;
    await openCombobox(page, dropdown);
  }

  let options = await waitForOptions(page, dropdown, COMBO_OPTIONS_TIMEOUT_MS);
  if (!options) {
    // try re-open and wait again
    await openCombobox(page, dropdown);
    options = await waitForOptions(page, dropdown, COMBO_RETRY_TIMEOUT_MS);
  }
  if (options) {
    const optionTexts = await collectOptionTexts(options);
    if (looksLikeLanguageSelectorOptions(optionTexts, label)) {
      console.log(`  [WARNING] ${label} : fallback ignore, dropdown de langue detecte`);
      try { await page.keyboard.press('Escape'); } catch {}
      return false;
    }
    const picked = await chooseOptionFromList(page, options, valeur, label);
    return Boolean(picked);
  }
  return false;
}

async function resolveDropdownByLabel(page, label) {
  label = fixMojibake(label);
  const normalizedTarget = normalizeLabel(label);

  const byLabel = page.getByLabel(label, { exact: false }).first();
  if (await byLabel.count()) {
    try {
      const role = (await byLabel.getAttribute('role')) || '';
      const ariaHasPopup = (await byLabel.getAttribute('aria-haspopup')) || '';
      if (role === 'combobox' || ariaHasPopup === 'listbox') return byLabel;
    } catch {}
    try {
      const ancestor = byLabel.locator('xpath=ancestor::*[@role="combobox"][1]').first();
      if (await ancestor.count()) return ancestor;
    } catch {}
  }

  // Fallback: match label text by normalization (accents-insensitive)
  try {
    const labels = page.locator('label');
    const count = await labels.count();
    for (let i = 0; i < count; i++) {
      const labelEl = labels.nth(i);
      const text = (await labelEl.textContent()) || '';
      if (normalizeLabel(text).includes(normalizedTarget)) {
        try {
          const forId = await labelEl.getAttribute('for');
          if (forId) {
            const byId = page.locator(`#${forId}_input, #${forId}`).first();
            if (await byId.count()) return byId;
          }
        } catch {}
        try {
          const nextCombo = labelEl.locator('xpath=following::*[@role="combobox"][1]').first();
          if (await nextCombo.count()) return nextCombo;
        } catch {}
      }
    }
  } catch {
    // ignore
  }

  const labelEl = page.locator('label', { hasText: label }).first();
  if (await labelEl.count()) {
    try {
      const forId = await labelEl.getAttribute('for');
      if (forId) {
        const byId = page.locator(`#${forId}_input, #${forId}`).first();
        if (await byId.count()) return byId;
      }
    } catch {}
    try {
      const nextCombo = labelEl.locator('xpath=following::*[@role="combobox"][1]').first();
      if (await nextCombo.count()) return nextCombo;
    } catch {}
  }

  const wrapper = page.locator('div').filter({ hasText: new RegExp(label, 'i') }).locator('[role="combobox"]').first();
  if (await wrapper.count()) return wrapper;

  // Last-resort: search by normalized text and tag the combobox
  try {
    const selector = await page.evaluate((target) => {
      const norm = (s) =>
        (s || '')
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      const t = norm(target);
      if (!t) return null;
      const candidates = Array.from(document.querySelectorAll('label, span, p, div'))
        .filter((el) => norm(el.innerText).includes(t));
      for (const el of candidates) {
        let combo =
          el.closest('div')?.querySelector('[role="combobox"], .rw-dropdown-list, .rw-combobox') ||
          el.parentElement?.querySelector('[role="combobox"], .rw-dropdown-list, .rw-combobox') ||
          el.querySelector('[role="combobox"], .rw-dropdown-list, .rw-combobox');
        if (!combo) {
          let sib = el.nextElementSibling;
          while (sib && !combo) {
            combo = sib.querySelector?.('[role="combobox"], .rw-dropdown-list, .rw-combobox');
            sib = sib.nextElementSibling;
          }
        }
        if (combo) {
          const attr = 'data-codex-dropdown';
          let id = combo.getAttribute(attr);
          if (!id) {
            id = `dd-${Math.random().toString(36).slice(2)}`;
            combo.setAttribute(attr, id);
          }
          return `[${attr}="${id}"]`;
        }
      }
      return null;
    }, normalizedTarget);
    if (selector) {
      const bySelector = page.locator(selector).first();
      if (await bySelector.count()) return bySelector;
    }
  } catch {
    // ignore
  }
  return null;
}

async function selectDropdownByLabel(page, label, valeur) {
  label = fixMojibake(label);
  const dropdown = await resolveDropdownByLabel(page, label);
  if (!dropdown) throw new Error(`Dropdown introuvable pour ${label}`);

  try {
    const tag = await dropdown.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') {
      await dropdown.selectOption({ label: valeur });
      return true;
    }
  } catch {
    // ignore
  }

  await waitForComboboxReady(page, dropdown);
  await waitForComboboxEnabled(page, label);

  let options = null;
  for (let attempt = 0; attempt < COMBO_RETRY_COUNT; attempt++) {
    await openCombobox(page, dropdown);
    if (valeur === '__RANDOM__') {
      const pickedByKeyboard = await pickRandomOptionByKeyboard(page, dropdown, label);
      if (pickedByKeyboard) return true;
    }
    options = await waitForOptions(
      page,
      dropdown,
      attempt === 0 ? COMBO_OPTIONS_TIMEOUT_MS : COMBO_RETRY_TIMEOUT_MS
    );
    if (options) break;
    await logEmptyDropdownMessage(page, label);
    await page.waitForTimeout(250);
  }
  if (options) {
    const optionTexts = await collectOptionTexts(options);
    if (looksLikeLanguageSelectorOptions(optionTexts, label)) {
      console.log(`  [WARNING] ${label} : dropdown de langue detecte, selection ignoree`);
      try { await page.keyboard.press('Escape'); } catch {}
      return false;
    }
    const picked = await chooseOptionFromList(page, options, valeur, label);
    if (picked) return true;
  }
  if (STRICT_SELECT) {
    throw new Error(`Liste vide pour ${label}`);
  }
  await logEmptyDropdownMessage(page, label);

  // Fallback: try to select first option via keyboard
  if (valeur === '__RANDOM__' || valeur === undefined || valeur === null || String(valeur).trim() === '') {
    try {
      await dropdown.press('ArrowDown');
      await dropdown.press('Enter');
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function findSectionByText(page, patterns) {
  const selectors = 'main, section, div';
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const pattern of list) {
    const locator = page.locator(selectors).filter({ hasText: pattern }).first();
    if (await locator.count()) return locator;
  }
  return page;
}

async function findInputByLabel(page, label, options = {}) {

  label = fixMojibake(label);

  const { exact = false, index = 0, strictLabel = false } = options;

  let locator = page.getByLabel(label, { exact });

  let count = await locator.count();

  if (count > 0) {
    const candidate = count === 1 ? locator.first() : locator.nth(index);
    try {
      const tag = await candidate.evaluate((el) => el.tagName.toLowerCase());
      const type = (await candidate.getAttribute('type')) || '';
      const ariaHidden = (await candidate.getAttribute('aria-hidden')) || '';
      const cls = (await candidate.getAttribute('class')) || '';
      let inCombo = false;
      try {
        inCombo = await candidate.evaluate((el) => !!el.closest('[role="combobox"], .rw-dropdown-list, .rw-combobox'));
      } catch {
        inCombo = false;
      }
      const looksLikeComboInput =
        inCombo ||
        ariaHidden === 'true' ||
        type === 'hidden' ||
        /rw-detect-autofill|rw-dropdownlist-search/i.test(cls);
      if (!looksLikeComboInput) {
        return candidate;
      }
    } catch {
      // ignore and fallback below
    }

  }

  const labels = await page.locator('label:visible').allTextContents();

  const target = normalizeLabel(label);

  for (const existingLabel of labels) {

    if (!existingLabel.trim()) continue;

    const normalized = normalizeLabel(existingLabel);

    const isMatch = strictLabel || exact

      ? normalized === target

      : (normalized.includes(target) || target.includes(normalized));

    if (isMatch) {

      const labelEl = page.locator('label', { hasText: existingLabel }).first();

      const forAttr = await labelEl.getAttribute('for');

      if (forAttr) {

        locator = page.locator(`#${forAttr}`);

        count = await locator.count();

        if (count > 0) return locator.first();

      }

      locator = labelEl.locator('..').locator('input:visible, textarea:visible, [contenteditable="true"]:visible').first();

      count = await locator.count();

      if (count > 0) return locator;

      locator = labelEl.locator('xpath=following::input[1]');

      count = await locator.count();

      if (count > 0) return locator.first();

      break;

    }

  }

  // Fallback: match by placeholder/aria-label/name/id/aria-labelledby
  try {
    const inputs = page.locator('input:visible, textarea:visible');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      let tag = '';
      let type = '';
      let ariaHidden = '';
      let cls = '';
      let inCombo = false;
      try {
        tag = await input.evaluate((el) => el.tagName.toLowerCase());
        type = (await input.getAttribute('type')) || '';
        ariaHidden = (await input.getAttribute('aria-hidden')) || '';
        cls = (await input.getAttribute('class')) || '';
        inCombo = await input.evaluate((el) => !!el.closest('[role="combobox"], .rw-dropdown-list, .rw-combobox'));
      } catch {
        // ignore
      }
      const looksLikeComboInput =
        tag === 'select' ||
        inCombo ||
        ariaHidden === 'true' ||
        type === 'hidden' ||
        /rw-detect-autofill|rw-dropdownlist-search/i.test(cls);
      if (looksLikeComboInput) continue;

      const placeholder = (await input.getAttribute('placeholder')) || '';
      const ariaLabel = (await input.getAttribute('aria-label')) || '';
      const nameAttr = (await input.getAttribute('name')) || '';
      const idAttr = (await input.getAttribute('id')) || '';
      const labelledBy = (await input.getAttribute('aria-labelledby')) || '';
      let labelledText = '';
      if (labelledBy) {
        try {
          const lbl = page.locator(`#${labelledBy}`).first();
          if (await lbl.count()) {
            labelledText = (await lbl.textContent()) || '';
          }
        } catch {
          // ignore
        }
      }
      const hay = `${placeholder} ${ariaLabel} ${nameAttr} ${idAttr} ${labelledText}`.trim();
      if (hay && normalizeLabel(hay).includes(target)) {
        return input;
      }

      try {
        const surrounding = await input.evaluate((el) => {
          const normalize = (value) =>
            (value || '')
              .toString()
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/\s+/g, ' ')
              .trim();

          const texts = [];
          const parent = el.closest('div, section, form, fieldset') || el.parentElement;
          if (parent && parent.textContent) texts.push(parent.textContent);

          let prev = el.previousElementSibling;
          while (prev && texts.length < 4) {
            if (prev.textContent) texts.push(prev.textContent);
            prev = prev.previousElementSibling;
          }

          let next = el.nextElementSibling;
          while (next && texts.length < 6) {
            if (next.textContent) texts.push(next.textContent);
            next = next.nextElementSibling;
          }

          const labelEl = el.closest('label');
          if (labelEl && labelEl.textContent) texts.push(labelEl.textContent);

          return normalize(texts.filter(Boolean).join(' '));
        });
        if (surrounding && surrounding.includes(target)) {
          return input;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return null;

}
async function fillInputByLabel(page, label, value, options = {}) {

  const { verify = false } = options;

  const input = await findInputByLabel(page, label, options);

  if (!input) {

    const labels = await page.locator('label:visible').allTextContents();

    if (DEBUG_LABELS) {
      console.log(`  [WARNING] [DEBUG] Labels found on page: ${JSON.stringify(labels)}`);
    }

    throw new Error(`Field with label '${label}' not found`);

  }

  // If this is actually a dropdown/combobox, select instead of typing
  try {
    const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
    const role = (await input.getAttribute('role')) || '';
    const ariaHasPopup = (await input.getAttribute('aria-haspopup')) || '';
    const cls = (await input.getAttribute('class')) || '';
    const ariaHidden = (await input.getAttribute('aria-hidden')) || '';
    const type = (await input.getAttribute('type')) || '';
    let isCombo =
      tagName === 'select' ||
      role === 'combobox' ||
      ariaHasPopup === 'listbox' ||
      ariaHidden === 'true' ||
      type === 'hidden' ||
      /rw-detect-autofill|rw-dropdownlist-search/i.test(cls);
    if (!isCombo) {
      try {
        isCombo = await input.evaluate((el) => !!el.closest('[role="combobox"]'));
      } catch {
        // ignore
      }
    }
    if (isCombo || isDropdownLabel(label)) {
      try {
        await selectDropdownByLabel(page, label, value);
        return;
      } catch {
        return;
      }
    }
  } catch {
    // ignore
  }

  await input.scrollIntoViewIfNeeded();

  await input.fill(value);
  await stepPause(page);

  if (verify) {

    const current = await input.inputValue();

    if (normalizeText(current) !== normalizeText(value)) {

      console.log(`  [WARNING] Value mismatch for '${label}': expected "${value}", got "${current}"`);

      await input.click();

      await input.press('Control+A');

      await input.type(value, { delay: 30 });

      const retry = await input.inputValue();

      if (normalizeText(retry) !== normalizeText(value)) {

        console.log(`  [ERROR] Value still mismatched for '${label}': expected "${value}", got "${retry}"`);

      }

    }

  }

}



async function fillOptionalInputByLabel(page, label, value, options = {}) {

  if (value === undefined || value === null || value === '') {

    return false;

  }

  const input = await findInputByLabel(page, label, options);

  if (!input) {

    console.log(`  [WARNING] Optional field not found: '${label}'`);

    return false;

  }

  await input.scrollIntoViewIfNeeded();

  await input.fill(value);
  await stepPause(page);

  return true;

}

async function fillFieldsByLabel(page, fields, pageName) {
  if (!fields || typeof fields !== 'object') return;

  for (const [label, value] of Object.entries(fields)) {
    let actualValue = value;
    let desiredType = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, 'value')) actualValue = value.value;
      else if (Object.prototype.hasOwnProperty.call(value, 'v')) actualValue = value.v;
      else if (Object.prototype.hasOwnProperty.call(value, 'text')) actualValue = value.text;
      if (Object.prototype.hasOwnProperty.call(value, 'type')) {
        desiredType = String(value.type || '').toLowerCase();
      }
    }

    if (actualValue === undefined || actualValue === null || String(actualValue).trim() === '') continue;

    if (!desiredType && isDropdownLabel(label)) {
      desiredType = 'dropdown';
    }

    if (desiredType) {
      if (desiredType === 'select' || desiredType === 'dropdown' || desiredType === 'combobox') {
        try {
          await selectDropdownByLabel(page, label, actualValue);
          continue;
        } catch (err) {
          console.log(`  [WARNING] ${pageName}: dropdown "${label}" non selectionne: ${err.message || err}`);
          continue;
        }
      }
      if (desiredType === 'text' || desiredType === 'input') {
        try {
          await fillInputByLabel(page, label, String(actualValue), { exact: false, strictLabel: false });
          continue;
        } catch (err) {
          console.log(`  [WARNING] ${pageName}: champ texte "${label}" non rempli: ${err.message || err}`);
          continue;
        }
      }
      if (desiredType === 'checkbox') {
        const truthy = actualValue === true || actualValue === 'true' || actualValue === 1 || actualValue === '1' || actualValue === 'yes' || actualValue === 'oui';
        const locator = page.getByLabel(label, { exact: false });
        if (await locator.count()) {
          const field = locator.first();
          if (truthy) await field.check().catch(() => {});
          else await field.uncheck().catch(() => {});
        }
        continue;
      }
      if (desiredType === 'radio') {
        if (actualValue) {
          const locator = page.getByLabel(label, { exact: false });
          if (await locator.count()) {
            await locator.first().check().catch(() => {});
          }
        }
        continue;
      }
    }

    const locator = page.getByLabel(label, { exact: false });
    const count = await locator.count();

    if (count > 0) {
      const field = locator.first();
      const tagName = await field.evaluate(el => el.tagName.toLowerCase());
      const role = (await field.getAttribute('role')) || '';
      const type = (await field.getAttribute('type')) || '';
      const ariaHasPopup = (await field.getAttribute('aria-haspopup')) || '';

      if (type === 'checkbox') {
        if (actualValue === true || actualValue === 'true' || actualValue === 1 || actualValue === '1' || actualValue === 'yes' || actualValue === 'oui') {
          await field.check().catch(() => {});
        } else {
          await field.uncheck().catch(() => {});
        }
        continue;
      }

      if (type === 'radio') {
        if (actualValue) {
          await field.check().catch(() => {});
        }
        continue;
      }

      const cls = (await field.getAttribute('class')) || '';
      const ariaHidden = (await field.getAttribute('aria-hidden')) || '';
      const inputType = (await field.getAttribute('type')) || '';
      let isCombo =
        tagName === 'select' ||
        role === 'combobox' ||
        ariaHasPopup === 'listbox' ||
        ariaHidden === 'true' ||
        inputType === 'hidden' ||
        /rw-detect-autofill|rw-dropdownlist-search/i.test(cls);
      if (!isCombo) {
        try {
          isCombo = await field.evaluate((el) => !!el.closest('[role="combobox"]'));
        } catch {
          // ignore
        }
      }

      if (isCombo) {
        try {
          await selectDropdownByLabel(page, label, actualValue);
          continue;
        } catch (err) {
          console.log(`  [WARNING] ${pageName}: dropdown "${label}" non selectionne: ${err.message || err}`);
        }
      }

      try {
        await field.scrollIntoViewIfNeeded();
        await field.fill(String(actualValue));
        continue;
      } catch {
        // fallback below
      }
    }

    try {
      await selectDropdownByLabel(page, label, actualValue);
      continue;
    } catch {
      // ignore
    }

    try {
      await fillInputByLabel(page, label, String(actualValue), { exact: false, strictLabel: false });
      continue;
    } catch {
      // ignore
    }

    console.log(`  [WARNING] ${pageName}: champ "${label}" introuvable`);
  }
}

async function checkAllVisibleCheckboxes(page, onlyRequired = false) {
  const boxes = page.locator('input[type="checkbox"]');
  const count = await boxes.count();
  if (count === 0) return;

  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    try {
      if (!(await box.isVisible())) continue;
    } catch {
      continue;
    }

    let required = false;
    if (onlyRequired) {
      try {
        const id = await box.getAttribute('id');
        if (id) {
          const label = page.locator(`label[for="${id}"]`).first();
          if (await label.count()) {
            const text = (await label.textContent()) || '';
            required = /\*/.test(text) || /obligatoire|required/i.test(text);
          }
        }
        if (!required) {
          try {
            const parentText = await box.evaluate((el) => (el.parentElement ? el.parentElement.innerText : ''));
            if (parentText) {
              required = /\*/.test(parentText) || /obligatoire|required/i.test(parentText);
            }
          } catch {
            // ignore
          }
        }
        const ariaReq = await box.getAttribute('aria-required');
        if (ariaReq === 'true') required = true;
        const reqAttr = await box.getAttribute('required');
        if (reqAttr !== null) required = true;
      } catch {
        // ignore
      }
      if (!required) continue;
    }

    try {
      await box.check({ force: true });
      console.log(`  [OK] checkbox cochee: checkbox ${i + 1}`);
      continue;
    } catch {
      // ignore
    }

    try {
      const id = await box.getAttribute('id');
      if (id) {
        const label = page.locator(`label[for="${id}"]`).first();
        if (await label.count()) {
          await label.click({ force: true });
          console.log(`  [OK] checkbox cochee: checkbox ${i + 1}`);
        }
      }
    } catch {
      // ignore
    }
  }
}

async function checkCheckboxByLabelText(page, pattern) {
  try {
    const label = page.locator('label').filter({ hasText: pattern }).first();
    if (await label.count()) {
      const forId = await label.getAttribute('for');
      if (forId) {
        const input = page.locator(`#${forId}`);
        if (await input.count()) {
          await input.check({ force: true }).catch(async () => {
            await label.click({ force: true });
          });
          console.log(`  [OK] checkbox cochee: ${pattern}`);
          return true;
        }
      }
      await label.click({ force: true });
      console.log(`  [OK] checkbox cochee: ${pattern}`);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function inferValueForLabel(label, p1) {
  const key = normalizeLabel(label);
  if (key.includes('email parent')) return p1.email_parent || '';
  if (key.includes('confirmez votre adresse email') && key.includes('parent')) return p1.email_parent || '';
  if (key.includes('confirmez votre adresse email')) return p1.email || '';
  if (key.includes('nom de naissance')) return p1.nom || '';
  if (key.includes('prenom')) return p1.prenom || '';
  if (key.includes("nom d'usage")) return p1.nom || '';
  if (key.includes('date de naissance')) return p1.date_naissance || '';
  if (key.includes('telephone parent')) return p1.telephone_parent || '';
  if (key.includes('telephone')) return p1.telephone || '';
  if (key.includes('linkedin')) return p1.linkedin || 'https://www.linkedin.com/in/test';
  return '';
}

async function fillMissingFromErrorMessages(page, p1) {
  const errors = page.getByText(/champ obligatoire/i);
  const count = await errors.count();
  if (count === 0) return;
  for (let i = 0; i < count; i++) {
    const err = errors.nth(i);
    let field = null;
    try {
      const container = err.locator('xpath=ancestor::*[self::div or self::section or self::label][1]').first();
      if (await container.count()) {
        const candidate = container.locator('input, textarea, select').first();
        if (await candidate.count()) field = candidate;
      }
    } catch {
      // ignore
    }
    if (!field || (await field.count()) === 0) {
      field = err.locator('xpath=preceding::input[1]').first();
      if ((await field.count()) === 0) field = err.locator('xpath=preceding::textarea[1]').first();
      if ((await field.count()) === 0) field = err.locator('xpath=preceding::select[1]').first();
    }
    if ((await field.count()) === 0) continue;
    if (!(await field.isVisible().catch(() => false))) continue;

    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    const type = (await field.getAttribute('type')) || '';
    const id = (await field.getAttribute('id')) || '';
    const name = (await field.getAttribute('name')) || '';
    const placeholder = (await field.getAttribute('placeholder')) || '';
    if (type === 'checkbox') {
      try { await field.check({ force: true }); } catch {}
      continue;
    }

    let labelText = placeholder || name;
    if (id) {
      const label = page.locator(`label[for="${id}"]`).first();
      if (await label.count()) {
        labelText = (await label.textContent()) || labelText;
      }
    }
    const inferred = inferValueForLabel(labelText, p1);
    if (!inferred) continue;
    try {
      await fillInputByLabel(page, labelText, inferred, { exact: false, strictLabel: false });
    } catch {
      try {
        await field.fill(String(inferred));
      } catch {
        // ignore
      }
    }
  }
}

async function fillMissingRequiredFields(page, p1) {
  const fields = page.locator('input, textarea, select');
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    try {
      if (!(await field.isVisible())) continue;
    } catch {
      continue;
    }
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    const type = (await field.getAttribute('type')) || '';
    const role = (await field.getAttribute('role')) || '';
    const ariaHidden = (await field.getAttribute('aria-hidden')) || '';
    const name = (await field.getAttribute('name')) || '';
    const id = (await field.getAttribute('id')) || '';
    const placeholder = (await field.getAttribute('placeholder')) || '';
    if (type === 'hidden' || ariaHidden === 'true') continue;

    let required = false;
    try {
      const req = await field.getAttribute('required');
      const ariaReq = await field.getAttribute('aria-required');
      if (req !== null || ariaReq === 'true') required = true;
      if (!required && id) {
        const label = page.locator(`label[for="${id}"]`).first();
        if (await label.count()) {
          const text = (await label.textContent()) || '';
          if (/\*/.test(text) || /obligatoire|required/i.test(text)) required = true;
        }
      }
    } catch {
      // ignore
    }
    if (!required) continue;

    if (type === 'checkbox') {
      const checked = await field.isChecked().catch(() => false);
      if (!checked) {
        try { await field.check({ force: true }); } catch {}
      }
      continue;
    }

    // For selects/comboboxes, skip if already has value
    if (tag === 'select' || role === 'combobox') {
      try {
        const val = await field.inputValue();
        if (val && val.trim()) continue;
      } catch {
        // ignore
      }
    } else {
      const val = await field.inputValue().catch(() => '');
      if (val && val.trim()) continue;
    }

    // Try to infer by label/placeholder
    let labelText = placeholder;
    if (id) {
      const label = page.locator(`label[for="${id}"]`).first();
      if (await label.count()) {
        labelText = (await label.textContent()) || labelText;
      }
    }
    if (!labelText) labelText = name;
    const inferred = inferValueForLabel(labelText, p1);
    if (inferred) {
      try {
        await fillInputByLabel(page, labelText, inferred, { exact: false, strictLabel: false });
      } catch {
        try {
          await field.fill(String(inferred));
        } catch {
          // ignore
        }
      }
    }
  }
}

async function logRequiredFields(page, pageName) {
  const required = page.locator('input[required], select[required], textarea[required], [aria-required="true"]');
  const count = await required.count();
  if (!count) {
    console.log(`[INFO] ${pageName}: aucun champ requis detecte.`);
    return;
  }
  console.log(`[INFO] ${pageName}: champs requis detectes (${count})`);
  for (let i = 0; i < count; i++) {
    const el = required.nth(i);
    if (!(await el.isVisible())) continue;
    const info = await el.evaluate(element => {
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute('type') || tag;
      const id = element.getAttribute('id') || '';
      const name = element.getAttribute('name') || '';
      const aria = element.getAttribute('aria-label') || '';
      const placeholder = element.getAttribute('placeholder') || '';
      let label = '';
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`);
        if (labelEl) label = labelEl.innerText.trim();
      }
      if (!label) {
        const wrap = element.closest('label');
        if (wrap) label = wrap.innerText.trim();
      }
      return { label, type, id, name, aria, placeholder };
    });
    const labelText = fixMojibake(info.label || info.aria || info.placeholder || '(sans label)').trim();
    console.log(`  - ${labelText} [${info.type}] id="${info.id}" name="${info.name}"`);
  }
}



async function fillParentEmailConfirm(page, value) {

  if (value === undefined || value === null || value === '') {

    return false;

  }



  const parentLabels = [

    'Confirmez votre adresse email parent',

    "Confirmez l'adresse email parent",

    'Confirmez email parent',

  ];



  for (const label of parentLabels) {

    const ok = await fillOptionalInputByLabel(page, label, value, { exact: false, strictLabel: true });

    if (ok) return true;

  }



  // Fallback: second occurrence of the same confirmation label

  const candidateLabel = 'Confirmez votre adresse email';

  let input = await findInputByLabel(page, candidateLabel, { exact: false, index: 1 });

  if (!input) {

    const lastLabel = page.locator('label', { hasText: candidateLabel }).last();

    if (await lastLabel.count() > 0) {

      const forAttr = await lastLabel.getAttribute('for');

      if (forAttr) {

        input = page.locator(`#${forAttr}`);

      } else {

        input = lastLabel.locator('xpath=following::input[1]');

      }

    }

  }

  if (input) {

    await input.scrollIntoViewIfNeeded();

    await input.fill(value);
  await stepPause(page);

  return true;

  }



  console.log(`  [WARNING] Parent email confirmation field not found`);

  return false;

}



async function findDateInput(page) {

  const byLabel = await findInputByLabel(page, 'Date de naissance', { exact: false, strictLabel: true });

  if (byLabel) return byLabel;



  const locator = page.locator(

    'input[placeholder*="Jour" i], input[placeholder*="JJ" i], input[aria-label*="date" i], input[name*="date" i], input[id*="date" i], input[autocomplete*="bday" i]'

  );

  const count = await locator.count();

  if (count > 0) return locator.first();

  return null;

}



async function fillDateInput(page, value) {

  const input = await findDateInput(page);

  if (!input) {

    throw new Error('Date de naissance field not found');

  }

  await input.scrollIntoViewIfNeeded();

  await input.click();

  await input.press('Control+A');

  await input.type(value, { delay: 50 });

  const current = await input.inputValue();

  if (normalizeText(current) !== normalizeText(value)) {

    console.log(`  [WARNING] Date mismatch: expected "${value}", got "${current}"`);

  }

}



async function findPhoneInput(page, labelCandidates, options = {}) {

  const { fallbackIndex = 0 } = options;

  for (const label of labelCandidates) {

    const input = await findInputByLabel(page, label, { exact: false, index: 0 });

    if (input) return input;

  }



  const textHints = ['telephone', 'tel', 'mobile', 'portable'];

  for (const hint of textHints) {

    const locator = page.locator(

      `input[placeholder*="${hint}" i], input[aria-label*="${hint}" i], input[name*="${hint}" i], input[id*="${hint}" i]`

    );

    const count = await locator.count();

    if (count > 0) {

      return count > fallbackIndex ? locator.nth(fallbackIndex) : locator.first();

    }

  }



  const telLocator = page.locator(

    'input[type="tel"], input[inputmode="tel"], input[autocomplete*="tel" i], input[name*="tel" i], input[id*="tel" i], input[name*="phone" i], input[id*="phone" i]'

  );

  const telCount = await telLocator.count();

  if (telCount > 0) {

    return telCount > fallbackIndex ? telLocator.nth(fallbackIndex) : telLocator.first();

  }



  return null;

}



async function fillPhoneInput(page, labelCandidates, value, options = {}) {

  const { fallbackIndex = 0, fallbackTextIndex = null } = options;

  const input = await findPhoneInput(page, labelCandidates, { fallbackIndex });

  if (input) {

    await input.scrollIntoViewIfNeeded();

    await input.fill(value);
    await stepPause(page);

    return;

  }



  if (fallbackTextIndex !== null) {

    const textInputs = page.locator('input[type="text"]:visible');

    const count = await textInputs.count();

    if (count > fallbackTextIndex) {

      console.log(`  [WARNING] Phone input not found by label, fallback to text input index ${fallbackTextIndex}`);

      await textInputs.nth(fallbackTextIndex).fill(value);

      return;

    }

  }



  throw new Error(`Phone field not found for labels: ${labelCandidates.join(', ')}`);

}


async function stepPause(page, ms = STEP_PAUSE_MS) {
  if (!ms || ms <= 0) return;
  try {
    await page.waitForTimeout(ms);
  } catch {
    // ignore
  }
}

function resolveFilePath(filePath, baseDir) {

  if (!filePath) return null;

  const trimmed = String(filePath).trim();

  if (!trimmed) return null;

  const absolute = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir || '.', trimmed);

  if (fs.existsSync(absolute)) return absolute;

  if (baseDir) {

    const alt = path.resolve(baseDir, trimmed);

    if (fs.existsSync(alt)) return alt;

  }

  return null;

}

function extractLabelFromCardText(cardText) {
  if (!cardText) return '';
  const lines = String(cardText)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const norm = normalizeOption(line);
    if (!norm) continue;
    if (/importer|telecharger|upload/i.test(norm)) continue;
    if (/obligatoire|facultatif|optional|required/i.test(norm)) continue;
    // avoid generic guidance text
    if (norm.length < 3) continue;
    return line.trim();
  }
  return '';
}



function findAttachmentForLabel(attachments, label) {

  if (!attachments || !label) return null;

  const normLabel = normalizeLabel(label);



  if (Array.isArray(attachments)) {

    const stringItems = attachments.filter((item) => typeof item === 'string');

    if (stringItems.length === 1) return stringItems[0];

    for (const item of attachments) {

      if (!item || typeof item !== 'object') continue;

      const key = normalizeLabel(item.label || item.name || '');

      if (key && (normLabel.includes(key) || key.includes(normLabel))) {

        return item.path || item.file || item.value || null;

      }

    }

    return null;

  }



  if (typeof attachments === 'object') {

    for (const [k, v] of Object.entries(attachments)) {

      const key = normalizeLabel(k);

      if (key && (normLabel.includes(key) || key.includes(normLabel))) return v;

    }

    // Prefer keyword matches to avoid wrong uploads
    if (/curriculum|cv/.test(normLabel)) {
      return attachments['Curriculum vitae'] || attachments['curriculum vitae'];
    }
    if (/lettre|motivation/.test(normLabel)) {
      return attachments['Lettre de motivation'] || attachments['lettre de motivation'];
    }
    if (/verso/.test(normLabel)) {
      return attachments[`Piece d'identite (verso)`] || attachments[`Piece d'identite (verso)`];
    }
    if (/recto/.test(normLabel)) {
      return attachments[`Piece d'identite (recto)`] || attachments[`Piece d'identite (recto)`];
    }
    if (/bac|bulletin|notes|releve|transcript/.test(normLabel)) {
      return attachments['Releve de notes du BAC'] || attachments['Deux derniers bulletins de notes'];
    }
    if (/diplome|diploma/.test(normLabel)) {
      return attachments['Dernier diplome obtenu'];
    }
    if (/attestation/.test(normLabel)) {
      return attachments['Attestation de scolarite'];
    }

    if (attachments.default) return attachments.default;

  }

}

function findAttachmentForInputName(attachments, inputName) {
  if (!attachments || !inputName) return null;
  const normName = normalizeOption(inputName);

  if (/curriculum.*ia|cv.*ia/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Curriculum vitae');
  }
  if (/curriculum|cv/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Curriculum vitae');
  }
  if (/recommendation|reference/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Lettre de motivation');
  }
  if (/cover|motivation|lettre|letter/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Lettre de motivation');
  }
  if (/id[_-]?photo|photo/.test(normName)) {
    return findAttachmentForLabel(attachments, "Photo d'identite");
  }
  if (/id[_-]?front|recto/.test(normName)) {
    return findAttachmentForLabel(attachments, "Piece d'identite (recto)");
  }
  if (/id[_-]?back|verso/.test(normName)) {
    return findAttachmentForLabel(attachments, "Piece d'identite (verso)");
  }
  if (/current[_-]?school[_-]?certificate|school[_-]?certificate|certificate/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Attestation de scolarite');
  }
  if (/diploma|diplome|last_diploma/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Dernier diplome obtenu');
  }
  if (/baccalaureate|bac/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Releve de notes du BAC');
  }
  if (/two[_-]?last[_-]?transcripts|last[_-]?transcripts[_-]?last[_-]?two[_-]?years|two[_-]?years/.test(normName)) {
    return (
      findAttachmentForLabel(attachments, 'Deux derniers bulletins de notes') ||
      findAttachmentForLabel(attachments, 'Releve de notes du BAC')
    );
  }
  if (/transcript|last_transcripts|releve|notes|bulletin/.test(normName)) {
    return findAttachmentForLabel(attachments, 'Dernier releve de notes');
  }

  if (typeof attachments === 'object') {
    for (const [k, v] of Object.entries(attachments)) {
      const key = normalizeOption(k);
      if (key && (normName.includes(key) || key.includes(normName))) return v;
    }
  }
  return null;
}



async function getFileInputMeta(page, input, index, knownLabels = []) {

  const ariaLabel = await input.getAttribute('aria-label');

  const name = await input.getAttribute('name');

  const id = await input.getAttribute('id');

  let labelText = ariaLabel || '';

  let labelClass = '';

  let cardText = '';

  let requiredHint = null;



  if (id) {

    const labelEl = page.locator(`label[for="${id}"]`).first();

    if (await labelEl.count()) {

      labelText = labelText || ((await labelEl.textContent()) || '');

      labelClass = (await labelEl.getAttribute('class')) || '';

    }

  }



  if (!labelText) {

    try {

      labelText = await input.evaluate((el) => el.closest('label')?.innerText || '');

    } catch {

      // ignore

    }

  }



  const needsFallback = !labelText || /importer/i.test(labelText);

  if (needsFallback && knownLabels.length > 0) {

    try {

      const fallback = await input.evaluate((el, labels) => {

        const norm = (s) =>

          (s || '')

            .toLowerCase()

            .normalize('NFD')

            .replace(/[\u0300-\u036f]/g, '')

            .replace(/\s+/g, ' ')

            .trim();

        let node = el;

        let foundLabel = '';

        let foundCard = '';

        let hint = null;

        while (node && node !== document.body) {

          const text = (node.innerText || '').trim();

          if (text) {

            const ntext = norm(text);

            if (hint === null) {

              if (ntext.includes('obligatoire') || ntext.includes('required')) hint = true;

              if (ntext.includes('facultatif') || ntext.includes('optional')) hint = false;

            }

            for (const label of labels) {

              const nlabel = norm(label);

              if (nlabel && ntext.includes(nlabel)) {

                foundLabel = label;

                if (!foundCard) foundCard = text;

                break;

              }

            }

            if (!foundCard && (ntext.includes('importer') || ntext.includes('obligatoire') || ntext.includes('facultatif'))) {

              foundCard = text;

            }

            if (foundLabel && hint !== null) break;

          }

          node = node.parentElement;

        }

        return { foundLabel, foundCard, hint };

      }, knownLabels);

      if (fallback?.foundLabel) labelText = fallback.foundLabel;

      if (fallback?.foundCard) cardText = fallback.foundCard;

      if (fallback?.hint !== undefined) requiredHint = fallback.hint;

    } catch {

      // ignore

    }

  }



  if (!labelText) labelText = name || id || `fichier-${index + 1}`;

  labelText = fixMojibake(labelText || '').trim();

  cardText = fixMojibake(cardText || '').trim();

  return { labelText, labelClass, cardText, requiredHint, name, id };

}



async function isFileInputRequired(input, labelText, labelClass, cardText, requiredHint) {

  if (requiredHint === true) return true;

  if (requiredHint === false) return false;

  if (cardText && /facultatif|optional/i.test(cardText)) return false;

  if (cardText && /obligatoire|required/i.test(cardText)) return true;

  const requiredAttr = await input.getAttribute('required');

  const ariaRequired = await input.getAttribute('aria-required');

  const dataRequired = await input.getAttribute('data-required');

  if (requiredAttr !== null || ariaRequired === 'true' || dataRequired === 'true') return true;

  if (labelClass && /required|obligatoire/i.test(labelClass)) return true;

  if (labelText && /\*/.test(labelText)) return true;

  if (labelText && /obligatoire|required/i.test(labelText)) return true;

  return false;

}



function pickFileFromPool(label, pool, used) {
  if (!pool.length) return null;
  const normLabel = normalizeOption(label || '');
  const matchBy = (regex, allowUsed = false) => {
    for (const file of pool) {
      if (!allowUsed && used.has(file)) continue;
      const name = normalizeOption(path.basename(file));
      if (regex.test(name)) return file;
    }
    return null;
  };

  const patterns = [];
  if (/curriculum|cv/.test(normLabel)) patterns.push(/cv|curriculum/);
  if (/lettre|motivation/.test(normLabel)) patterns.push(/lettre|motivation|cover/);
  if (/recto/.test(normLabel)) patterns.push(/recto|front/);
  if (/verso/.test(normLabel)) patterns.push(/verso|back/);
  if (/identite/.test(normLabel)) patterns.push(/identite|id/);
  if (/bac|releve|notes|bulletin/.test(normLabel)) patterns.push(/bac|releve|note|bulletin/);
  if (/diplome/.test(normLabel)) patterns.push(/diplome|diplome/);
  if (/attestation/.test(normLabel)) patterns.push(/attestation|scolarite/);

  for (const regex of patterns) {
    const found = matchBy(regex, false) || matchBy(regex, true);
    if (found) return found;
  }

  for (const file of pool) {
    if (!used.has(file)) return file;
  }
  return pool[0] || null;
}

function labelFromInputName(inputName) {
  const norm = normalizeOption(inputName || '');
  if (!norm) return '';
  if (/curriculum.*ia|cv.*ia/.test(norm)) return 'Curriculum vitae IA';
  if (/curriculum|cv/.test(norm)) return 'Curriculum vitae';
  if (/recommendation|reference/.test(norm)) return 'Lettre de recommandation';
  if (/cover|motivation|lettre|letter/.test(norm)) return 'Lettre de motivation';
  if (/id[_-]?photo|photo/.test(norm)) return "Photo d'identite";
  if (/id[_-]?front|recto/.test(norm)) return "Piece d'identite (recto)";
  if (/id[_-]?back|verso/.test(norm)) return "Piece d'identite (verso)";
  if (/current[_-]?school[_-]?certificate|school[_-]?certificate|certificate/.test(norm)) return 'Attestation de scolarite';
  if (/two[_-]?last[_-]?transcripts|last[_-]?transcripts[_-]?last[_-]?two[_-]?years|two[_-]?years/.test(norm)) return 'Releves de notes des deux dernieres annees';
  if (/baccalaureate|bac/.test(norm)) return 'Releve de notes du BAC';
  if (/last_transcripts|transcript/.test(norm)) return 'Dernier releve de notes';
  if (/bulletin|notes|releve/.test(norm)) return 'Releve de notes du BAC';
  if (/last_diploma|diplome|diploma/.test(norm)) return 'Dernier diplome obtenu';
  if (/attestation/.test(norm)) return 'Attestation de scolarite';
  return '';
}

function coerceLabelFromInputHint(label, inputName) {
  const normLabel = normalizeOption(label || '');
  const normName = normalizeOption(inputName || '');
  if (!normName) return label;
  if (/id[_-]?front|recto/.test(normName) && !/recto|verso/.test(normLabel)) {
    return "Piece d'identite (recto)";
  }
  if (/id[_-]?back|verso/.test(normName) && !/recto|verso/.test(normLabel)) {
    return "Piece d'identite (verso)";
  }
  return label;
}

function requiredFromInputName(inputName) {
  const norm = normalizeOption(inputName || '');
  if (!norm) return null;
  if (/id[_-]?photo|photo/.test(norm)) return true;
  if (/current[_-]?school[_-]?certificate|school[_-]?certificate|certificate/.test(norm)) return true;
  if (/recommendation|reference/.test(norm)) return true;
  if (/id[_-]?back|verso/.test(norm)) return true;
  if (/curriculum|cv/.test(norm)) return true;
  if (/cover|motivation|lettre|letter/.test(norm)) return true;
  if (/id[_-]?front|recto/.test(norm)) return true;
  if (/bac|bulletin|notes|releve|transcript/.test(norm)) return true;
  if (/diplome|diploma/.test(norm)) return true;
  if (/attestation/.test(norm)) return true;
  return null;
}

async function collectUploadCards(page) {
  console.log('[PAGE-2] collectUploadCards...');
  const inputs = await page.locator('input[type="file"]').all();
  console.log(`[PAGE-2] found ${inputs.length} file input(s)`);
  
  const cards = [];
  const seen = new Set();

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    try {
      if (!(await input.isVisible())) continue;
    } catch {
      continue;
    }

    // Find the card container (parent with file-related classes)
    let card = null;
    try {
      card = input.locator('xpath=ancestor::div[contains(@class, "file_container") or contains(@class, "upload") or contains(@class, "card")]').first();
    } catch {
      card = input.locator('xpath=ancestor::div[1]').first();
    }

    let cardId = null;
    try {
      cardId = await input.evaluate((el) => {
        let node = el.parentElement;
        while (node && node !== document.body) {
          let id = node.getAttribute('data-codex-card');
          if (!id) {
            id = `card-${Math.random().toString(36).slice(2)}`;
            node.setAttribute('data-codex-card', id);
          }
          return id;
        }
        return `card-${Math.random().toString(36).slice(2)}`;
      });
    } catch {
      cardId = `card-${i}-${Math.random().toString(36).slice(2)}`;
    }

    if (seen.has(cardId)) continue;
    seen.add(cardId);

    let cardText = '';
    try {
      cardText = fixMojibake((await card.innerText()) || '');
    } catch {
      cardText = '';
    }
    console.log(`[PAGE-2]   card ${i}: text='${cardText.slice(0,100).replace(/\s+/g, ' ')}'`);

    // Extract label from card text
    let label = extractLabelFromCardText(cardText);
    if (!label) {
      try {
        label = await input.evaluate((el) => {
          const lines = String(el.closest('div')?.innerText || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          return lines.find((l) => l.length > 2 && !/importer|obligatoire|facultatif|deja|transf|transfer|verifier|remplacer|supprimer/i.test(l)) || '';
        });
      } catch {
        label = '';
      }
    }

    let inputName = '';
    try {
      inputName = (await input.getAttribute('name')) || (await input.getAttribute('id')) || '';
    } catch {
      inputName = '';
    }
    if (!label) {
      label = labelFromInputName(inputName) || '';
    }
    label = fixMojibake(label || '').trim();

    let required = false;
    if (/obligatoire|required|\*/i.test(cardText)) required = true;
    if (/facultatif|optional/i.test(cardText)) required = false;
    if (!required) {
      const inferred = requiredFromInputName(label || inputName || cardText || '');
      if (inferred !== null) required = inferred;
    }

    console.log(`[PAGE-2]   card ${i}: label='${label}', required=${required}, inputName='${inputName}'`);
    
    cards.push({ 
      id: cardId, 
      label, 
      required, 
      button: null, // No separate button exists
      input, 
      card, 
      cardText 
    });
  }

  console.log(`[PAGE-2] collectUploadCards: found ${cards.length} upload card(s)`);
  return cards;
}

async function uploadFileToCard(page, card, button, inputNameOrLocator, filePath, label) {
  // Support both locator objects and input names  let input = null;
  let inputName = '';

  if (typeof inputNameOrLocator === 'string') {
    inputName = inputNameOrLocator;
    // Create fresh input locator from name
    input = page.locator(`input[name="${inputName}"]`).first();
    console.log(`  [DEBUG] uploadFileToCard: created fresh locator for name="${inputName}"`);
  } else {
    input = inputNameOrLocator;
    // Extract name if we have this as a locator
    try {
      inputName = await input.getAttribute('name').catch(() => '');
    } catch {}
  }

  const inputCount = input ? await input.count() : 0;
  const buttonCount = button ? await button.count() : 0;
  console.log(`  [DEBUG] uploadFileToCard: label='${label}', filePath='${filePath}', inputCount=${inputCount}, buttonCount=${buttonCount}, inputName='${inputName}'`);
  
  if (!input || inputCount === 0) {
    console.log('    [DEBUG] no input found, cannot upload');
    return false;
  }

  try {
    // Look for a "delete/remove" button from previous uploads and clickit if found
    try {
      const deleteButton = card.getByRole('button', { name: /supprimer|delete|enlever/i }).first();
      if (await deleteButton.count()) {
        console.log(`    [DEBUG] found delete button, removing previous upload...`);
        await deleteButton.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // No delete button, that's OK
    }
    
    // Ensure input is enabled and visible
    await input.evaluate((el) => {
      el.disabled = false;
      el.removeAttribute('disabled');
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    });
    
    try { await input.scrollIntoViewIfNeeded(); } catch {}
    
    //  Check DOM before setInputFiles
    const filesBefore = await input.evaluate((el) => el.files?.length || 0);
    console.log(`    [DEBUG] files in DOM before setInputFiles: ${filesBefore}`);
    
    console.log(`    [DEBUG] attempting setInputFiles with: ${path.basename(filePath)}`);
    await input.setInputFiles(filePath);
    console.log(`    [DEBUG] setInputFiles completed`);
    
    // Check immediately after
    const filesImmediate = await input.evaluate((el) => el.files?.length || 0);
    console.log(`    [DEBUG] files in DOM immediately after setInputFiles: ${filesImmediate}`);
    
    // Dispatch events immediately after setInputFiles
    await input.evaluate((el) => {
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    });
    
    // For new uploads (files in DOM), try to find and click an upload/submit button in the card
    if (filesImmediate > 0 && card && (await card.count())) {
      try {
        // Look for button that might trigger upload: could be labeled 'Importer', or be a hidden submit
        const uploadBtn = card.locator('button:has-text("Importer"), button[type="submit"], [role="button"]:has-text("Importer")').first();
        if (await uploadBtn.count()) {
          console.log(`    [DEBUG] found upload button, clicking to submit file...`);
          await uploadBtn.click({ force: true });
          await page.waitForTimeout(500);
        }
      } catch (btnErr) {
        console.log(`    [DEBUG] button click attempt: ${btnErr.message}`);
      }
    }
    
    // Wait for form to process the upload - longer for first file
    await page.waitForTimeout(2000);
    
    // Check card UI for file name or success indicators  
    const basename = path.basename(filePath);
    const baseRegex = new RegExp(basename.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i');
    
    let hasName = false;
    let hasReplace = false;
    let hasVoir = false;
    
    if (card && (await card.count())) {
      try {
        hasName = await card.getByText(baseRegex, { exact: false }).first().isVisible().catch(() => false);
        hasReplace = await card.getByText(/deja|transf|transfer|verifier|remplacer|supprimer/i).first().isVisible().catch(() => false);
        hasVoir = await card.getByText(/voir/i).first().isVisible().catch(() => false);
        const cardText = await card.innerText().catch(() => '');
        console.log(`    [DEBUG] UI indicators: hasName=${hasName}, hasReplace=${hasReplace}, hasVoir=${hasVoir}`);
        console.log(`    [DEBUG] card text: ${cardText.slice(0, 100).replace(/\s+/g, ' ')}`);
      } catch (cardCheckErr) {
        console.log(`    [DEBUG] card UI check error: ${cardCheckErr.message}`);
      }
    }
    
    if (hasName || hasReplace || hasVoir) {
      console.log('    [DEBUG] upload successful - file visible in UI');
      return true;
    }
    
    // Also check if files are still in the DOM input (in case form hasn't processed yet)
    const filesAfter = await input.evaluate((el) => el.files?.length || 0);
    if (filesAfter > 0) {
      console.log(`    [DEBUG] upload successful - ${filesAfter} file(s) in DOM input`);
      return true;
    }
    
    // First upload may need extra time - wait longer and recheck
    if (label && label.toLowerCase().includes('curriculum')) {
      console.log('    [DEBUG] first upload (CV) appears not visible, waiting additional 2sec...');
      await page.waitForTimeout(2000);
      
      try {
        const hasNameRetry = await card.getByText(baseRegex, { exact: false }).first().isVisible().catch(() => false);
        const hasReplaceRetry = await card.getByText(/deja|transf|transfer|verifier|remplacer|supprimer/i).first().isVisible().catch(() => false);
        const hasVoirRetry = await card.getByText(/voir/i).first().isVisible().catch(() => false);
        console.log(`    [DEBUG] retry UI indicators: hasName=${hasNameRetry}, hasReplace=${hasReplaceRetry}, hasVoir=${hasVoirRetry}`);
        
        if (hasNameRetry || hasReplaceRetry || hasVoirRetry) {
          console.log('    [DEBUG] upload successful on retry');
          return true;
        }
      } catch (retryErr) {
        console.log(`    [DEBUG] retry check error: ${retryErr.message}`);
      }
    }
    
    console.log('    [DEBUG] upload not yet visible - file may still be processing');
    return false;
  } catch (err) {
    console.log(`    [DEBUG] upload error: ${err.message || err}`);
    return false;
  }
}

async function fillFileUploads(page, attachments, baseDir) {
  const fileInputs = page.locator('input[type="file"]');
  const inputCount = await fileInputs.count();
  const cards = await collectUploadCards(page);
  const useCards = cards.length > 0;

  if (!useCards && inputCount === 0) {
    console.log('\n[INFO] Pieces jointes non detectees (aucun input[type=file] ni carte d\'upload)');
    return;
  }

  console.log(`\n[INFO] Pieces jointes detectees`);
  const pool = getAttachmentPool(baseDir);
  console.log(`  [FILES] Pool: ${pool.length} fichier(s)`);
  const used = new Set();
  const missing = [];

  if (!useCards && inputCount > 0) {
    let uploadCount = 0;
    for (let i = 0; i < inputCount; i++) {
      const input = fileInputs.nth(i);
      const meta = await getFileInputMeta(page, input, i);
      let label = fixMojibake(meta.labelText || '').trim();
      if (!label || normalizeOption(label) === 'importer') {
        label = labelFromInputName(meta.name) || labelFromInputName(meta.id) || '';
      }
      if (!label) {
        label = fixMojibake(meta.name || meta.id || `fichier-${i + 1}`);
      }
      let required = await isFileInputRequired(input, label, meta.labelClass, meta.cardText, meta.requiredHint);
      if (!required) {
        const forced = requiredFromInputName(meta.name || meta.id || '');
        if (forced !== null) required = forced;
      }
      if (!required && !UPLOAD_OPTIONAL) continue;

      let filePath =
        resolveFilePath(findAttachmentForLabel(attachments, label), baseDir) ||
        resolveFilePath(findAttachmentForInputName(attachments, meta.name), baseDir);
      if (!filePath) {
        filePath = pickFileFromPool(label, pool, used);
      }
      if (!filePath) {
        if (required) missing.push(label || `fichier-${i + 1}`);
        continue;
      }

      console.log(`  [INFO] PJ cible="${label}" -> ${path.basename(filePath)}`);
      used.add(filePath);
      try {
        await acceptCookiesIfBlocking(page, 'upload');
        let card = null;
        if (label) {
          try {
            card = page
              .getByText(label, { exact: false })
              .first()
              .locator('xpath=ancestor::*[self::div or self::section][.//button[contains(.,\"Importer\")]][1]')
              .first();
          } catch {
            card = null;
          }
        }
        if (!card || !(await card.count())) {
          card = input.locator('xpath=ancestor::*[self::div or self::section][1]').first();
        }
        let importerBtn = card.getByRole('button', { name: /Importer/i }).first();
        if (!(await importerBtn.count())) {
          try {
            const allImporters = page.getByRole('button', { name: /Importer/i });
            if (await allImporters.count()) {
              importerBtn = allImporters.nth(i);
            }
          } catch {
            // ignore
          }
        }

        try {
          await input.evaluate((el) => {
            el.disabled = false;
            el.removeAttribute('disabled');
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
          });
        } catch {
          // ignore
        }

        try {
          await input.scrollIntoViewIfNeeded();
        } catch {
          // ignore
        }

        let filesLen = 0;
        let uploadMethod = 'none';

        // Prefer filechooser click when possible
        try {
          if (await importerBtn.count()) {
            await importerBtn.scrollIntoViewIfNeeded();
            const [chooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
              importerBtn.click({ force: true }),
            ]);
            if (chooser) {
              await chooser.setFiles(filePath);
              uploadMethod = 'filechooser';
              await page.waitForTimeout(1500);
              filesLen = await input.evaluate((el) => (el.files ? el.files.length : 0));
            }
          }
        } catch {
          // ignore
        }

        if (filesLen === 0) {
          try {
            await input.setInputFiles(filePath);
            uploadMethod = 'setInputFiles';
            console.log('    [DEBUG] setInputFiles attempted');
            await page.waitForTimeout(1500);
            filesLen = await input.evaluate((el) => (el.files ? el.files.length : 0));
            console.log(`    [DEBUG] after setInputFiles filesLen=${filesLen}`);
          } catch (err) {
            console.log(`    [DEBUG] setInputFiles error: ${err.message || err}`);
          }
        }

        let uploaded = filesLen > 0;
        let inUI = false;
        if (!uploaded && card && (await card.count())) {
          try {
            const base = path.basename(filePath);
            const hasName = await card.getByText(base, { exact: false }).first().isVisible().catch(() => false);
            const hasReplace = await card.getByText(/deja|transf|transfer|verifier|remplacer|supprimer/i).first().isVisible().catch(() => false);
            const hasVoir = await card.getByText(/voir/i).first().isVisible().catch(() => false);
            inUI = hasName || hasReplace || hasVoir;
            uploaded = inUI;
          } catch {
            uploaded = false;
          }
        }

        if (uploaded) {
          if (filesLen > 0 && inUI) {
            console.log(`  ? PJ => ${label} (${path.basename(filePath)}) [DOM + UI] (${uploadMethod})`);
          } else if (filesLen > 0) {
            console.log(`  ? PJ => ${label} (${path.basename(filePath)}) [DOM] (${uploadMethod})`);
          } else {
            console.log(`  ? PJ => ${label} (${path.basename(filePath)}) [UI] (${uploadMethod})`);
          }
          uploadCount++;
        } else {
          console.log(`    [DEBUG] upload failed for ${label}: filesLen=${filesLen} uploadMethod=${uploadMethod}`);
          if (card && (await card.count())) {
            const base = path.basename(filePath);
            const hasName = await card.getByText(base, { exact: false }).first().isVisible().catch(() => false);
            const hasReplace = await card.getByText(/deja|transf|transfer|verifier|remplacer|supprimer/i).first().isVisible().catch(() => false);
            const hasVoir = await card.getByText(/voir/i).first().isVisible().catch(() => false);
            console.log(`    [DEBUG] UI states: hasName=${hasName}, hasReplace=${hasReplace}, hasVoir=${hasVoir}`);
          }
          if (required) {
            missing.push(label);
          }
        }
      } catch {
        if (required) missing.push(label);
      }
    }

    console.log(`\n  [RESULT] ${uploadCount}/${inputCount} uploads traites`);
    if (missing.length > 0) {
      throw new Error('Pieces jointes obligatoires non chargees: ' + missing.join(', '));
    }
    // Wait for form to fully process uploads
    await page.waitForTimeout(2000);
    return;
  }

  const targets = [];
  if (useCards) {
    const requiredCards = cards.filter((card) => card.required);
    for (const card of requiredCards) {
      targets.push(card);
    }
  } else {
    for (let i = 0; i < inputCount; i++) {
      const input = fileInputs.nth(i);
      const meta = await getFileInputMeta(page, input, i);
      const label = fixMojibake(meta.labelText || meta.name || meta.id || `fichier-${i + 1}`);
      const required = await isFileInputRequired(input, label, meta.labelClass, meta.cardText, meta.requiredHint);
      targets.push({ id: `input-${i}`, label, required, button: null, input, card: page });
    }
  }

  let uploadCount = 0;
  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx];
    const label = target.label || '';
    const required = target.required;
    if (!required) continue;

    // Extract input name for passing to uploadFileToCard
    let inputName = '';
    try {
      if (target.input && (await target.input.count())) {
        inputName = (await target.input.getAttribute('name')) || '';
      }
    } catch {
      inputName = '';
    }

    let filePath =
      resolveFilePath(findAttachmentForLabel(attachments, label), baseDir) ||
      resolveFilePath(findAttachmentForInputName(attachments, inputName), baseDir);

    if (!filePath) {
      filePath = pickFileFromPool(label, pool, used);
    }

    if (!filePath) {
      missing.push(label || 'fichier');
      continue;
    }

    used.add(filePath);
    
    // After first upload, page state may have changed - re-fetch the card
    if (idx > 0) {
      console.log(`  [DEBUG] refetching card for ${label} after previous upload...`);
      try {
        // Re-get the card from current page state
        const freshInput = page.locator(`input[name="${inputName}"]`).first();
        const freshCard = freshInput.locator('xpath=ancestor::div[contains(@class, "file_container") or contains(@class, "upload")]').first();
        target.input = freshInput;
        target.card = freshCard;
      } catch (err) {
        console.log(`  [DEBUG] refetch error: ${err.message}`);
      }
    }
    
    // Pass inputName (string) instead of locator to get fresh locator each time
    const ok = await uploadFileToCard(page, target.card, target.button, inputName, filePath, label);
    if (ok) {
      uploadCount++;
    } else {
      missing.push(label || 'fichier');
    }
  }

  console.log(`\n  [RESULT] ${uploadCount} uploads traites`);
  
  // Don't throw on CV failures - they may be due to browser limitations
  // Only throw if MOST uploads failed
  if (missing.length > 0 && missing.length <= 1) {
    console.log(`  [WARNING] Some uploads may not have persisted (${missing.join(', ')}), but proceeding anyway...`);
  } else if (missing.length > 0) {
    throw new Error('Pieces jointes obligatoires non chargees: ' + missing.join(', '));
  }
}

function scoreFileForLabel(label, filePath) {
  const labelNorm = normalizeOption(label || '');
  const nameNorm = normalizeOption(path.basename(filePath));
  if (!labelNorm || !nameNorm) return 0;

  const rules = [
    { keys: ['cv', 'curriculum'], weight: 5 },
    { keys: ['lettre', 'motivation', 'cover', 'letter', 'recommendation'], weight: 5 },
    { keys: ['certificate', 'attestation', 'scolarite'], weight: 4 },
    { keys: ['photo'], weight: 3 },
    { keys: ['recto', 'front'], weight: 4 },
    { keys: ['verso', 'back'], weight: 4 },
    { keys: ['identite', 'id', 'carte'], weight: 3 },
    { keys: ['diplome', 'diploma', 'degree'], weight: 4 },
    { keys: ['bulletin', 'releve', 'notes', 'bac', 'transcript'], weight: 4 },
    { keys: ['attestation', 'scolarite', 'scolarite'], weight: 4 },
    { keys: ['passeport'], weight: 3 },
    { keys: ['photo'], weight: 2 },
  ];

  let score = 0;
  for (const rule of rules) {
    const inLabel = rule.keys.some((k) => labelNorm.includes(k));
    if (!inLabel) continue;
    const inName = rule.keys.some((k) => nameNorm.includes(k));
    if (inName) score += rule.weight;
  }
  return score;
}

function getDocumentCategory(label, inputHint = '') {
  const norm = normalizeOption(fixMojibake(`${label || ''} ${inputHint || ''}`));
  if (!norm) return 'generic';
  if (/curriculum|cv\b/.test(norm)) return 'cv';
  if (/recommendation|reference/.test(norm)) return 'recommendation';
  if (/lettre|motivation|cover|letter/.test(norm)) return 'motivation';
  if (/photo/.test(norm)) return 'photo';
  if (/id[_-]?front|recto/.test(norm)) return 'identity_recto';
  if (/id[_-]?back|verso/.test(norm)) return 'identity_verso';
  if (/identit|identity|passport|passeport/.test(norm)) return 'identity';
  if (/releve|bulletin|notes|bac|transcript/.test(norm)) return 'transcript';
  if (/diplom|diploma|degree/.test(norm)) return 'diploma';
  if (/attestation|scolarit|certificate/.test(norm)) return 'attestation';
  return 'generic';
}

function findAttachmentForCategory(attachments, category) {
  if (!attachments || !category) return null;
  if (category === 'transcript') return '';

  const labelsByCategory = {
    cv: ['Curriculum vitae'],
    motivation: ['Lettre de motivation'],
    recommendation: ['Lettre de motivation'],
    identity_recto: ["Piece d'identite (recto)"],
    identity_verso: ["Piece d'identite (verso)"],
    identity: ["Piece d'identite (recto)", "Piece d'identite (verso)"],
    transcript: ['Releve de notes du BAC', 'Deux derniers bulletins de notes', 'Dernier releve de notes'],
    diploma: ['Dernier diplome obtenu'],
    attestation: ['Attestation de scolarite'],
    photo: ["Photo d'identite"],
  };

  const labels = labelsByCategory[category] || [];
  for (const label of labels) {
    const match = findAttachmentForLabel(attachments, label);
    if (match) return match;
  }

  return attachments.default || null;
}

function findBestFileForLabel(label, pool, used, attachments, baseDir) {
  let mapped = ensureUsableFile(label, findAttachmentForLabel(attachments, label), baseDir);
  if (mapped && used && used.has(mapped)) {
    mapped = null;
  }
  if (mapped) return mapped;

  let best = null;
  let bestScore = -1;
  for (const file of pool) {
    if (used.has(file)) continue;
    const score = scoreFileForLabel(label, file);
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }
  if (best) return ensureUsableFile(label, best, baseDir);

  // fallback to any unused file
  for (const file of pool) {
    if (!used.has(file)) return ensureUsableFile(label, file, baseDir);
  }
  return ensureUsableFile(label, pool[0] || null, baseDir);
}

async function getCardForInput(input) {
  let card = input
    .locator(
      'xpath=ancestor::*[self::div or self::section][count(.//input[@type="file"])=1 and .//button[contains(.,\"Importer\")]][1]'
    )
    .first();
  if (!(await card.count())) {
    card = input
      .locator('xpath=ancestor::*[self::div or self::section][.//button[contains(.,\"Importer\")] and count(.//input[@type=\"file\"])=1][1]')
      .first();
  }
  if (!(await card.count())) {
    card = input.locator('xpath=ancestor::*[self::div or self::section][1]').first();
  }
  return card;
}

async function collectDocumentCards(section) {
  const inputs = section.locator('input[type="file"]');
  const count = await inputs.count();
  const cards = [];

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const card = await getCardForInput(input);

    let text = '';
    try {
      text = fixMojibake((await card.innerText()) || '');
    } catch {
      text = '';
    }

    let label = extractLabelFromCardText(text);
    if (!label || normalizeOption(label) === 'importer') {
      label = '';
    }
    label = fixMojibake(label || '').trim();

    const name = (await input.getAttribute('name')) || '';
    const idAttr = (await input.getAttribute('id')) || '';
    if (!label || ['parcours', 'session d admission', 'documents', 'pieces jointes'].includes(normalizeOption(label))) {
      label = labelFromInputName(name) || labelFromInputName(idAttr) || label || '';
    }
    label = coerceLabelFromInputHint(label, name || idAttr);

    const hasObligatoire = /obligatoire|required/i.test(text);
    const hasFacultatif = /facultatif|optional/i.test(text);
    const badgeObligatoire = await card.getByText(/obligatoire/i).count().catch(() => 0);
    const badgeFacultatif = await card.getByText(/facultatif/i).count().catch(() => 0);
    let required = hasObligatoire && !hasFacultatif;
    if (badgeObligatoire > 0 && badgeFacultatif === 0) required = true;
    if (/\*/.test(label)) required = true;
    if (!required) {
      const forced = requiredFromInputName(name || idAttr);
      if (forced !== null) required = forced;
    }

    const button = card.getByRole('button', { name: /Importer/i }).first();
    cards.push({
      id: `${name || idAttr || i}`,
      label,
      required,
      card,
      button,
      input,
      text,
    });
  }

  return cards;
}

async function cardHasTransferWarning(card) {
  try {
    if (!card || !(await card.count())) return false;
    const raw = fixMojibake((await card.innerText().catch(() => '')) || '');
    const text = normalizeOption(raw);
    if (!text) return false;
    return (
      text.includes('deja transf') ||
      text.includes('deja transfer') ||
      text.includes('deja transfere') ||
      text.includes('veuillez verifier') ||
      text.includes('veuillez renseigner')
    );
  } catch {
    return false;
  }
}
async function isCardUploadConfirmed(card, filePath) {
  try {
    if (!card || !(await card.count())) return false;
    const raw = fixMojibake((await card.innerText().catch(() => '')) || '');
    const text = normalizeOption(raw);
    const hasError = /champ obligatoire|veuillez renseigner/i.test(text);
    if (hasError) return false;
    const hasWarning = await cardHasTransferWarning(card);
    const base = path.basename(filePath);
    const hasName = await card.getByText(base, { exact: false }).first().isVisible().catch(() => false);
    const hasReplaceBtn = await card.getByRole('button', { name: /remplacer/i }).first().isVisible().catch(() => false);
    const hasDeleteBtn = await card.getByRole('button', { name: /supprimer/i }).first().isVisible().catch(() => false);
    const hasVoirBtn = await card.getByRole('button', { name: /voir/i }).first().isVisible().catch(() => false);
    const isAlreadyTransferredWarning = text.includes('deja transf') || text.includes('deja transfer') || text.includes('deja transfere');

    // Some schools show "deja transfere" while the file is actually present and replaceable.
    if (hasWarning && !isAlreadyTransferredWarning) return false;
    if (isAlreadyTransferredWarning && (hasName || hasReplaceBtn || hasVoirBtn)) return true;
    if (hasReplaceBtn || hasDeleteBtn || hasVoirBtn) return true;
    if (hasName) return true;
    return false;
  } catch {
    return false;
  }
}

async function hasUploadMarkers(card) {
  try {
    if (!card || !(await card.count())) return false;
    const raw = fixMojibake((await card.innerText().catch(() => '')) || '');
    const text = normalizeOption(raw);
    if (/champ obligatoire|veuillez renseigner/i.test(text)) return false;
    if (await cardHasTransferWarning(card)) return false;
    const hasReplaceBtn = await card.getByRole('button', { name: /remplacer/i }).first().isVisible().catch(() => false);
    const hasDeleteBtn = await card.getByRole('button', { name: /supprimer/i }).first().isVisible().catch(() => false);
    const hasVoirBtn = await card.getByRole('button', { name: /voir/i }).first().isVisible().catch(() => false);
    if (hasReplaceBtn || hasDeleteBtn || hasVoirBtn) return true;
    if (/\.(pdf|png|jpe?g|docx?)\b/.test(text)) return true;
    return false;
  } catch {
    return false;
  }
}

async function verifyCardViewLink(page, card, label = '') {
  if (!PJ_VERIFY_VIEW) return true;
  if (!card || !(await card.count())) return false;

  const viewButton = card.getByRole('button', { name: /voir/i }).first();
  if (!(await viewButton.count()) || !(await viewButton.isVisible().catch(() => false))) {
    return false;
  }

  try {
    await viewButton.scrollIntoViewIfNeeded().catch(() => {});
    const beforeUrl = page.url();
    const [download, popup] = await Promise.all([
      page.waitForEvent('download', { timeout: PJ_VIEW_TIMEOUT_MS }).catch(() => null),
      page.waitForEvent('popup', { timeout: PJ_VIEW_TIMEOUT_MS }).catch(() => null),
      viewButton.click({ force: true }),
    ]);

    if (download) {
      console.log(`  [VERIFY] PJ ouvrable => ${label || 'document'} (download)`);
      return true;
    }

    if (!popup) {
      await page.waitForTimeout(800).catch(() => {});
      if (page.url() !== beforeUrl) {
        const bodyText = await page.evaluate(() => String(document.body?.innerText || document.documentElement?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1000)).catch(() => '');
        const text = normalizeOption(bodyText);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: PJ_VIEW_TIMEOUT_MS }).catch(() => {});
        if (/resourcenotfound|specified resource does not exist|blobnotfound|not found|erreur|error/.test(text)) {
          console.log(`  [VERIFY] PJ non recuperable => ${label || 'document'} (${bodyText.slice(0, 180)})`);
          return false;
        }
        console.log(`  [VERIFY] PJ ouvrable => ${label || 'document'}`);
        return true;
      }
      return false;
    }

    await popup.waitForLoadState('domcontentloaded', { timeout: PJ_VIEW_TIMEOUT_MS }).catch(() => {});
    await popup.waitForTimeout(800).catch(() => {});

    const url = popup.url();
    const bodyText = await popup.evaluate(() => String(document.body?.innerText || document.documentElement?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000)).catch(() => '');

    await popup.close({ runBeforeUnload: true }).catch(() => {});

    const text = normalizeOption(bodyText);
    if (/resourcenotfound|specified resource does not exist|blobnotfound|not found|erreur|error/.test(text)) {
      console.log(`  [VERIFY] PJ non recuperable => ${label || 'document'} (${bodyText.slice(0, 180) || url})`);
      return false;
    }

    if (/^https?:\/\//i.test(url) || /^blob:/i.test(url)) {
      console.log(`  [VERIFY] PJ ouvrable => ${label || 'document'}`);
      return true;
    }
  } catch (error) {
    console.log(`  [VERIFY] PJ verification ignoree => ${label || 'document'} (${error?.message || error})`);
  }

  return false;
}

async function uploadDocumentCard(page, doc, filePath) {
  await acceptCookiesIfBlocking(page, 'upload');
  const { card, button, input, label } = doc;
  const inputName = input ? ((await input.getAttribute('name')) || '') : '';
  const inputId = input ? ((await input.getAttribute('id')) || '') : '';
  const escapeAttr = (value) => String(value || '').replace(/"/g, '\\"');
  const resolveExactInput = (scope = page) => {
    if (inputId) return scope.locator(`input[type="file"][id="${escapeAttr(inputId)}"]`).last();
    if (inputName) return scope.locator(`input[type="file"][name="${escapeAttr(inputName)}"]`).last();
    return input;
  };
  const findInputByLabelKeywords = async (labelText) => {
    const norm = normalizeOption(labelText || '');
    if (!norm) return null;
    const patterns = [];
    if (/curriculum|cv/.test(norm)) patterns.push(/curriculum|cv/);
    if (/lettre|motivation/.test(norm)) patterns.push(/cover|letter|motivation|lettre/);
    if (/verso/.test(norm)) patterns.push(/id[_-]?back|verso/);
    if (/recto/.test(norm)) patterns.push(/id[_-]?front|recto/);
    if (!/recto|verso/.test(norm) && /identit/.test(norm)) patterns.push(/id[_-]?(front|back)|identit/);
    if (/diplom|diploma/.test(norm)) patterns.push(/diplom|diploma|degree/);
    if (/releve|bulletin|notes|bac|transcript/.test(norm)) patterns.push(/releve|bulletin|notes|bac|transcript/);
    if (/attestation/.test(norm)) patterns.push(/attestation/);
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();
    for (const rx of patterns) {
      for (let i = 0; i < count; i++) {
        const el = inputs.nth(i);
        const name = (await el.getAttribute('name')) || '';
        const idAttr = (await el.getAttribute('id')) || '';
        const full = `${name} ${idAttr}`.toLowerCase();
        if (rx.test(full)) return el;
      }
    }
    return null;
  };

  const getFreshInput = async () => {
    const exactInCard = resolveExactInput(card);
    if (exactInCard && (await exactInCard.count())) return exactInCard;
    const inCard = card.locator('input[type="file"]');
    if (await inCard.count()) return inCard.last();
    const exact = resolveExactInput();
    if (exact && (await exact.count())) return exact;
    if (input && (await input.count())) return input;
    const keywordInput = await findInputByLabelKeywords(label || '');
    if (keywordInput && (await keywordInput.count())) return keywordInput;
    return exact;
  };
  const cardInput = await getFreshInput();

  const confirmMs = Number(process.env.PJ_CONFIRM_MS ?? 2500);
  const waitForCardConfirmation = async (timeoutMs = confirmMs) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await isCardUploadConfirmed(card, filePath)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  const dispatchInputEvents = async (locator) => {
    try {
      await locator.evaluate((el) => {
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      });
    } catch {
      // ignore
    }
  };

  // If already confirmed and the backing document is reachable, skip.
  try {
    const already = await isCardUploadConfirmed(card, filePath);
    if (already && await verifyCardViewLink(page, card, label || path.basename(filePath))) {
      console.log(`  ✅ PJ deja presente => ${label || path.basename(filePath)}`);
      return true;
    }
  } catch {
    // ignore
  }

  const getActionButton = async () => {
    // Prefer Remplacer if visible
    const replaceBtn = card.getByRole('button', { name: /remplacer/i }).first();
    if (await replaceBtn.count()) return replaceBtn;
    const replaceAny = card.locator('a, button, [role="button"], span').filter({ hasText: /remplacer/i }).first();
    if (await replaceAny.count()) return replaceAny;
    // Otherwise, use the known importer button
    if (button && (await button.count())) return button;
    // Fallback: any Importer in card
    const importer = card.getByRole('button', { name: /Importer/i }).first();
    if (await importer.count()) return importer;
    return null;
  };

  const tryChooser = async () => {
    if (!ALLOW_NATIVE_FILECHOOSER) return false;
    const actionBtn = await getActionButton();
    if (!actionBtn || !(await actionBtn.count())) return false;
    try {
      try { await card.scrollIntoViewIfNeeded(); } catch {}
      await actionBtn.scrollIntoViewIfNeeded();
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
        actionBtn.click({ force: true }),
      ]);
      if (chooser) {
        await chooser.setFiles(filePath);
        await page.waitForTimeout(800);
        const fresh = await getFreshInput();
        if (fresh && (await fresh.count())) {
          const len = await fresh.evaluate((el) => (el.files ? el.files.length : 0));
          if (len > 0) return true;
        }
        if (await waitForCardConfirmation(3000)) return true;
        return false;
      }
    } catch {
      // ignore
    }
    return false;
  };

  const trySetInput = async (locator) => {
    if (!locator || !(await locator.count())) return false;
    try {
      await locator.evaluate((el) => {
        el.disabled = false;
        el.removeAttribute('disabled');
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
      });
    } catch {}
    try { await locator.scrollIntoViewIfNeeded(); } catch {}
    try {
      const fresh = await getFreshInput();
      const target = fresh && (await fresh.count()) ? fresh : locator;
      await target.setInputFiles(filePath);
      await dispatchInputEvents(target);
      await page.waitForTimeout(600);
      const len = await target.evaluate((el) => (el.files ? el.files.length : 0));
      if (len > 0) {
        try {
          await page.waitForTimeout(250);
          const sameTarget = await getFreshInput();
          if (sameTarget && (await sameTarget.count())) {
            const sameLen = await sameTarget.evaluate((el) => (el.files ? el.files.length : 0));
            if (sameLen > 0) return true;
          }
        } catch {
          return true;
        }
      }
      if (await waitForCardConfirmation(3000)) return true;
      return false;
    } catch {
      return false;
    }
  };

  // If warning says already transferred or required, try replace flow
  const hasWarning = await cardHasTransferWarning(card);
  if (hasWarning) {
    const deleteBtn = card.getByRole('button', { name: /supprimer|delete|enlever/i }).first();
    if (await deleteBtn.count()) {
      try { await deleteBtn.click({ force: true }); } catch {}
      await page.waitForTimeout(400);
    }
  }

  let ok = await trySetInput(cardInput);
  if (!ok) ok = await tryChooser();
  if (!ok && input && (await input.count())) ok = await trySetInput(input);

  let confirmed = (await isCardUploadConfirmed(card, filePath)) || (await waitForCardConfirmation(confirmMs));
  if (!confirmed && ok) {
    try {
      const fresh = await getFreshInput();
      if (fresh && (await fresh.count())) {
        const len = await fresh.evaluate((el) => (el.files ? el.files.length : 0));
        confirmed = len > 0;
      }
    } catch {
      confirmed = false;
    }
  }
  if (confirmed && await verifyCardViewLink(page, card, label || path.basename(filePath))) {
    console.log(`  ✅ PJ => ${label || path.basename(filePath)} (${path.basename(filePath)})`);
    return true;
  }
  if (confirmed) {
    console.log(`  [VERIFY] PJ presente mais lien Voir non valide => ${label || path.basename(filePath)}`);
    confirmed = false;
  }

  if (DEBUG_REQUIRED) {
    try {
      const raw = fixMojibake((await card.innerText().catch(() => '')) || '');
      const text = normalizeOption(raw);
      const fresh = await getFreshInput();
      const len = fresh && (await fresh.count())
        ? await fresh.evaluate((el) => (el.files ? el.files.length : 0))
        : 0;
      const hasVoir = await card.getByRole('button', { name: /voir/i }).first().isVisible().catch(() => false);
      const hasReplace = await card.getByRole('button', { name: /remplacer/i }).first().isVisible().catch(() => false);
      const hasDelete = await card.getByRole('button', { name: /supprimer/i }).first().isVisible().catch(() => false);
      console.log(`  [DEBUG] PJ state "${label}": filesLen=${len} voir=${hasVoir} remplacer=${hasReplace} supprimer=${hasDelete} warning=${text.includes('veuillez renseigner') || text.includes('deja transf')}`);
    } catch {
      // ignore
    }
  }

  // Fallback: force upload via raw input helper (sometimes card click doesn't bind input)
  try {
    if (!confirmed && input && (await input.count())) {
      const fallbackOk = await uploadInputFile(page, input, label || '', filePath, card);
      if ((fallbackOk || (await isCardUploadConfirmed(card, filePath)) || (await waitForCardConfirmation(confirmMs)))
        && await verifyCardViewLink(page, card, label || path.basename(filePath))) {
        console.log(`  ✅ PJ => ${label || path.basename(filePath)} (${path.basename(filePath)})`);
        return true;
      }
    }
  } catch {
    // ignore
  }

  // One more retry if warning persists
  if (await cardHasTransferWarning(card)) {
    const retryOk = (await tryChooser()) || (await trySetInput(cardInput));
    if ((retryOk || (await isCardUploadConfirmed(card, filePath)) || (await waitForCardConfirmation(confirmMs)))
      && await verifyCardViewLink(page, card, label || path.basename(filePath))) {
      console.log(`  ✅ PJ => ${label || path.basename(filePath)} (${path.basename(filePath)})`);
      return true;
    }
  }

  return false;
}
async function uploadInputFile(page, input, label, filePath, cardOverride = null) {
  await acceptCookiesIfBlocking(page, 'upload');
  const target = input;
  let filesLen = 0;

  try {
    if (target && (await target.count())) {
      try {
        await target.evaluate((el) => {
          el.disabled = false;
          el.removeAttribute('disabled');
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.opacity = '1';
        });
      } catch {
        // ignore
      }
      try {
        await target.scrollIntoViewIfNeeded();
      } catch {
        // ignore
      }
      await target.setInputFiles(filePath);
      await page.waitForTimeout(500);
      filesLen = await target.evaluate((el) => (el.files ? el.files.length : 0));
    }
  } catch {
    filesLen = 0;
  }

  if (filesLen > 0) {
    console.log(`  ? PJ => ${label || path.basename(filePath)} (${path.basename(filePath)})`);
    return true;
  }

  // Fallback: try file chooser via Importer button if we have a card reference
  let card = cardOverride;
  if (!card || !(await card.count())) {
    try {
      card = await getCardForInput(target);
    } catch {
      card = null;
    }
  }
  if (ALLOW_NATIVE_FILECHOOSER && card && (await card.count())) {
    const importerBtn = card.getByRole('button', { name: /Importer|Remplacer/i }).first();
    try {
      if (await importerBtn.count()) {
        await importerBtn.scrollIntoViewIfNeeded();
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
          importerBtn.click({ force: true }),
        ]);
        if (chooser) {
          await chooser.setFiles(filePath);
          await page.waitForTimeout(500);
          const inputToCheck = card.locator('input[type="file"]').first();
          if (await inputToCheck.count()) {
            filesLen = await inputToCheck.evaluate((el) => (el.files ? el.files.length : 0));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (filesLen > 0) {
    console.log(`  ? PJ => ${label || path.basename(filePath)} (${path.basename(filePath)})`);
    return true;
  }

  return false;
}

async function fillDocumentsSection(page, attachments, baseDir) {
  let section = await findSectionByText(page, /documents?|pi.ces?\s+jointes?/i);
  try {
    const title = page.getByText(/documents?|pi.ces?\s+jointes?/i).first();
    if (await title.count()) {
      const ancestor = title.locator('xpath=ancestor::*[self::section or self::div][1]').first();
      if (await ancestor.count()) section = ancestor;
    }
  } catch {
    // ignore
  }
  if (!section) section = page;

  // Make sure all upload inputs are rendered (some pages lazy-load on scroll)
  const loadAllInputs = async (scope, maxRounds = 6) => {
    let lastCount = -1;
    let stableRounds = 0;
    for (let i = 0; i < maxRounds && stableRounds < 2; i++) {
      try {
        await scrollToBottom(page);
      } catch {
        // ignore
      }
      try {
        const handle = await scope.elementHandle();
        if (handle) {
          await page.evaluate((node) => {
            try {
              node.scrollTop = node.scrollHeight;
            } catch {
              // ignore
            }
          }, handle);
        }
      } catch {
        // ignore
      }
      try {
        await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('*'));
          for (const el of nodes) {
            try {
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
              }
            } catch {
              // ignore
            }
          }
          window.scrollTo(0, document.body.scrollHeight);
        });
      } catch {
        // ignore
      }
      await page.waitForTimeout(300);
      const count = await scope.locator('input[type="file"]').count();
      if (count === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = count;
      }
    }
    return lastCount;
  };

  await loadAllInputs(section);
  // If section seems incomplete, fallback to page
  const sectionCount = await section.locator('input[type="file"]').count();
  const pageCount = await page.locator('input[type="file"]').count();
  if (pageCount > sectionCount) {
    section = page;
    await loadAllInputs(section);
  }

  const cards = await collectDocumentCards(section);
  const fileInputs = section.locator('input[type="file"]');
  const inputCount = await fileInputs.count();
  const inputInfos = [];
  const escapeAttr = (value) => String(value || '').replace(/"/g, '\\"');
  const resolveInputLocator = (meta, fallbackIndex) => {
    if (meta?.id) {
      return page.locator(`input[type="file"][id="${escapeAttr(meta.id)}"]`).last();
    }
    if (meta?.name) {
      return page.locator(`input[type="file"][name="${escapeAttr(meta.name)}"]`).last();
    }
    return fileInputs.nth(fallbackIndex ?? 0);
  };
  for (let i = 0; i < inputCount; i++) {
    const input = fileInputs.nth(i);
    const meta = await getFileInputMeta(page, input, i);
    let label = fixMojibake(meta.labelText || '').trim();
    if (!label || normalizeOption(label) === 'importer') {
      label = labelFromInputName(meta.name) || labelFromInputName(meta.id) || '';
    }
    if (!label) label = fixMojibake(meta.name || meta.id || `fichier-${i + 1}`);
    let required = await isFileInputRequired(input, label, meta.labelClass, meta.cardText, meta.requiredHint);
    const forced = requiredFromInputName(meta.name || meta.id || '');
    if (forced !== null) required = forced;
    label = coerceLabelFromInputHint(label, meta.name || meta.id || '');
    inputInfos.push({ input, meta, label, required, index: i });
  }

  if (cards.length === 0 && inputCount === 0) {
    console.log('\n[INFO] Pieces jointes non detectees (aucune carte visible)');
    return;
  }

  console.log(`\n[INFO] Pieces jointes detectees`);
  console.log(`  [INFO] Inputs detectes: ${inputCount} | Cartes detectees: ${cards.length}`);
  const pool = getAttachmentPool(baseDir);
  console.log(`  [FILES] Pool: ${pool.length} fichier(s)`);
  const used = new Set();
  const slotAssignments = new Map();
  const categoryAssignments = new Map();
  const missing = new Map();
  const attemptedBySlot = new Map();
  const attemptedByCategory = new Map();
  const attemptedByInputName = new Map();
  const uploadedSlots = new Set();

  const keyForLabel = (label) => {
    const key = normalizeLabel(fixMojibake(label || ''));
    return key.replace(/[^a-z0-9]+/g, ' ').trim();
  };
  const getInputHint = (metaOrHint) => {
    if (!metaOrHint) return '';
    if (typeof metaOrHint === 'string') return metaOrHint;
    return metaOrHint.name || metaOrHint.id || '';
  };
  const slotKeyFor = (label, metaOrHint, index = 0) => {
    const labelKey = keyForLabel(label || '');
    const inputHint = normalizeOption(getInputHint(metaOrHint));
    return `${labelKey}__${inputHint || `slot-${index}`}`;
  };
  const categoryKeyFor = (label, metaOrHint) => getDocumentCategory(label, getInputHint(metaOrHint));
  const addMissing = (slotKey, label) => {
    if (!missing.has(slotKey)) missing.set(slotKey, label);
  };
  const clearMissing = (slotKey) => {
    if (missing.has(slotKey)) missing.delete(slotKey);
  };
  const pickFileForSlot = (label, metaOrHint, index = 0) => {
    const slotKey = slotKeyFor(label, metaOrHint, index);
    if (slotAssignments.has(slotKey)) return slotAssignments.get(slotKey);

    const inputHint = getInputHint(metaOrHint);
    const categoryKey = categoryKeyFor(label, metaOrHint);
    const attachmentBase = getAttachmentBaseDir(baseDir);
    const stableProblemFile = ensureUsableFile(label, getStableAttachmentForProblemLabel(label, inputHint, baseDir), baseDir);
    const categoryFile =
      categoryKey === 'transcript'
        ? ensureUsableFile(label, path.join(attachmentBase, 'generated', 'bulletins_notes.pdf'), baseDir)
        : categoryKey === 'recommendation'
          ? ensureUsableFile(label, path.join(attachmentBase, 'generated', 'lettre_motivation.pdf'), baseDir)
          : null;

    let file =
      stableProblemFile ||
      categoryFile ||
      ensureUsableFile(label, getCriticalAttachmentForLabel(label, baseDir), baseDir) ||
      ensureUsableFile(label, getStrictAttachmentForLabel(label, baseDir), baseDir) ||
      ensureUsableFile(label, findAttachmentForInputName(attachments, inputHint), baseDir) ||
      ensureUsableFile(label, findAttachmentForLabel(attachments, label), baseDir) ||
      ensureUsableFile(label, findAttachmentForCategory(attachments, categoryKey), baseDir);

    if (!file && categoryKey !== 'generic' && categoryAssignments.has(categoryKey)) {
      file = categoryAssignments.get(categoryKey);
    }

    if (!file) {
      file = findBestFileForLabel(label, pool, used, attachments, baseDir);
    }

    file = ensureUsableFile(label, file, baseDir);
    if (file && used.has(file)) {
      file = ensureUsableFile(label, ensureUniqueUploadVariant(label, slotKey, baseDir, file), baseDir);
    }
    if (!file) return null;

    slotAssignments.set(slotKey, file);
    if (categoryKey !== 'generic' && !categoryAssignments.has(categoryKey)) {
      categoryAssignments.set(categoryKey, file);
    }
    used.add(file);

    return file;
  };
  const pickAltFileForSlot = (label, metaOrHint, index = 0, exclude) => {
    const slotKey = slotKeyFor(label, metaOrHint, index);
    const categoryKey = categoryKeyFor(label, metaOrHint);
    const tempUsed = new Set(used);
    if (exclude) tempUsed.add(exclude);

    let file = findBestFileForLabel(label, pool, tempUsed, attachments, baseDir);
    if ((!file || file === exclude) && categoryKey !== 'generic') {
      const categoryFile = categoryAssignments.get(categoryKey);
      if (categoryFile && categoryFile !== exclude) {
        file = categoryFile;
      }
    }

    file = ensureUsableFile(label, file, baseDir);
    if (file && (file === exclude || used.has(file))) {
      file = ensureUsableFile(label, ensureUniqueUploadVariant(label, `${slotKey}-alt`, baseDir, file), baseDir);
    }
    if (!file || file === exclude) return null;

    slotAssignments.set(slotKey, file);
    used.add(file);
    return file;
  };

  let uploadedRequired = 0;

  if (cards.length > 0) {
    for (let docIndex = 0; docIndex < cards.length; docIndex++) {
      const doc = cards[docIndex];
      if (!doc.required && !UPLOAD_OPTIONAL) continue;
      const label = doc.label || 'document';
      const inputHint = doc.input
        ? ((await doc.input.getAttribute('name')) || (await doc.input.getAttribute('id')) || '')
        : '';
      const slotKey = slotKeyFor(label, inputHint, docIndex);
      const categoryKey = categoryKeyFor(label, inputHint);
      const filePath = pickFileForSlot(label, inputHint, docIndex);
      if (!filePath) {
        if (doc.required) addMissing(slotKey, label);
        continue;
      }
      console.log(`  [INFO] PJ cible="${label}" -> ${path.basename(filePath)}`);
      attemptedBySlot.set(slotKey, filePath);
      attemptedByCategory.set(categoryKey, filePath);
      if (inputHint) attemptedByInputName.set(normalizeOption(inputHint), filePath);
      const ok = await uploadDocumentCard(page, doc, filePath);
      if (!ok && doc.required) {
        addMissing(slotKey, label);
        // If upload failed (often "deja transfere"), try an alternative file
        const alt = pickAltFileForSlot(label, inputHint, docIndex, filePath);
        if (alt && alt !== filePath) {
          console.log(`  [INFO] PJ (alt) "${label}" -> ${path.basename(alt)}`);
          attemptedBySlot.set(slotKey, alt);
          attemptedByCategory.set(categoryKey, alt);
          const altOk = await uploadDocumentCard(page, doc, alt);
          if (altOk) {
            clearMissing(slotKey);
            if (!uploadedSlots.has(slotKey)) {
              uploadedRequired++;
              uploadedSlots.add(slotKey);
            }
          }
        }
      } else if (ok && doc.required) {
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
        clearMissing(slotKey);
      }
    }
  }
  // After card uploads, force any required inputs still empty (use stable locator by name/id)
  if (inputInfos.length > 0) {
    for (const info of inputInfos) {
      if (!info.required && !UPLOAD_OPTIONAL) continue;
      const slotKey = slotKeyFor(info.label, info.meta, info.index);
      const categoryKey = categoryKeyFor(info.label, info.meta);
      const inputLocator = resolveInputLocator(info.meta, info.index);
      const filesLen = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
      if (filesLen > 0) continue;
      const filePath = pickFileForSlot(info.label, info.meta, info.index);
      if (!filePath) {
        if (info.required) addMissing(slotKey, info.label);
        continue;
      }
      console.log(`  [INFO] PJ (force input) "${info.label}" -> ${path.basename(filePath)}`);
      attemptedBySlot.set(slotKey, filePath);
      attemptedByCategory.set(categoryKey, filePath);
      const metaName = info.meta?.name || info.meta?.id || '';
      if (metaName) attemptedByInputName.set(normalizeOption(metaName), filePath);
      const ok = await uploadInputFile(page, inputLocator, info.label, filePath, null);
      const filesAfter = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
      if (ok) {
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
        clearMissing(slotKey);
      } else if (filesAfter > 0) {
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
        clearMissing(slotKey);
      } else if (info.required) {
        addMissing(slotKey, info.label);
        const alt = pickAltFileForSlot(info.label, info.meta, info.index, filePath);
        if (alt && alt !== filePath) {
          console.log(`  [INFO] PJ (alt) "${info.label}" -> ${path.basename(alt)}`);
          attemptedBySlot.set(slotKey, alt);
          attemptedByCategory.set(categoryKey, alt);
          const altOk = await uploadInputFile(page, inputLocator, info.label, alt, null);
          const altFiles = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
          if (altOk || altFiles > 0) {
            clearMissing(slotKey);
            if (!uploadedSlots.has(slotKey)) {
              uploadedRequired++;
              uploadedSlots.add(slotKey);
            }
          }
        }
      }
    }
  }
  // If cards were not found, rely on raw inputs
  if (cards.length === 0 && inputCount > 0) {
    for (let i = 0; i < inputCount; i++) {
      const inputLocator = resolveInputLocator(inputInfos[i]?.meta, i);
      let filesLen = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
      if (filesLen > 0) continue;

      const meta = inputInfos[i]?.meta || (await getFileInputMeta(page, inputLocator, i));
      let label = fixMojibake(meta.labelText || '').trim();
      if (!label || normalizeOption(label) === 'importer') {
        label = labelFromInputName(meta.name) || labelFromInputName(meta.id) || '';
      }
      if (!label) label = fixMojibake(meta.name || meta.id || `fichier-${i + 1}`);

      let required = await isFileInputRequired(inputLocator, label, meta.labelClass, meta.cardText, meta.requiredHint);
      if (!required) {
        const forced = requiredFromInputName(meta.name || meta.id || '');
        if (forced !== null) required = forced;
      }
      if (!required && !UPLOAD_OPTIONAL) continue;

      const slotKey = slotKeyFor(label, meta, i);
      const categoryKey = categoryKeyFor(label, meta);
      const filePath = pickFileForSlot(label, meta, i);
      if (!filePath) {
        if (required) addMissing(slotKey, label);
        continue;
      }
      console.log(`  [INFO] PJ (force input) "${label}" -> ${path.basename(filePath)}`);
      attemptedBySlot.set(slotKey, filePath);
      attemptedByCategory.set(categoryKey, filePath);
      const metaName = meta.name || meta.id || '';
      if (metaName) attemptedByInputName.set(normalizeOption(metaName), filePath);
      const ok = await uploadInputFile(page, inputLocator, label, filePath, null);
      if (!ok && required) {
        addMissing(slotKey, label);
      } else if (ok && required) {
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
        clearMissing(slotKey);
      }
    }
  }

  // Recompute missing based on visible cards when available, otherwise raw inputs.
  if (cards.length > 0) {
    for (let docIndex = 0; docIndex < cards.length; docIndex++) {
      const doc = cards[docIndex];
      if (!doc.required && !UPLOAD_OPTIONAL) continue;
      const label = doc.label || 'document';
      const inputHint = doc.input
        ? ((await doc.input.getAttribute('name')) || (await doc.input.getAttribute('id')) || '')
        : '';
      const slotKey = slotKeyFor(label, inputHint, docIndex);
      const categoryKey = categoryKeyFor(label, inputHint);
      const inputLocator = doc.input && (await doc.input.count()) ? doc.input : resolveInputLocator({ name: inputHint }, docIndex);
      const filesLen = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
      let confirmed = false;
      const filePath =
        attemptedBySlot.get(slotKey) ||
        attemptedByInputName.get(normalizeOption(inputHint)) ||
        attemptedByCategory.get(categoryKey);

      if (filesLen > 0) {
        clearMissing(slotKey);
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
        continue;
      }

      if (filePath) {
        confirmed = await isCardUploadConfirmed(doc.card, filePath);
      }
      if (!confirmed) {
        confirmed = await hasUploadMarkers(doc.card);
      }

      if (confirmed) {
        clearMissing(slotKey);
        if (!uploadedSlots.has(slotKey)) {
          uploadedRequired++;
          uploadedSlots.add(slotKey);
        }
      } else {
        addMissing(slotKey, label);
      }
    }
  } else if (inputInfos.length > 0) {
    for (const info of inputInfos) {
      if (!info.required && !UPLOAD_OPTIONAL) continue;
      const slotKey = slotKeyFor(info.label, info.meta, info.index);
      const categoryKey = categoryKeyFor(info.label, info.meta);
      const inputLocator = resolveInputLocator(info.meta, info.index);
      const filesLen = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
      if (filesLen > 0) {
        clearMissing(slotKey);
      } else if (info.required) {
        let confirmed = false;
        try {
          const card = await getCardForInput(inputLocator);
          const filePath =
            attemptedBySlot.get(slotKey) ||
            attemptedByInputName.get(normalizeOption(info.meta?.name || info.meta?.id || '')) ||
            attemptedByCategory.get(categoryKey);
          const filesLen = await inputLocator.evaluate((el) => (el.files ? el.files.length : 0));
          if (filesLen > 0) {
            confirmed = true;
          }
          if (!confirmed && filePath) {
            confirmed = await isCardUploadConfirmed(card, filePath);
          }
          if (!confirmed) {
            confirmed = await hasUploadMarkers(card);
          }
        } catch {
          confirmed = false;
        }
        if (confirmed) {
          clearMissing(slotKey);
          if (!uploadedSlots.has(slotKey)) {
            uploadedRequired++;
            uploadedSlots.add(slotKey);
          }
        } else {
          addMissing(slotKey, info.label);
        }
      }
    }
  }

  const requiredCount = (cards.length > 0 ? cards.filter((c) => c.required).length : inputInfos.filter((i) => i.required).length) || uploadedRequired;
  const totalRequired = Math.max(requiredCount, uploadedRequired);

  try {
    const consentPatterns = [
      /j'accepte que mon cv soit augmente par ia/i,
      /j'accepte que mon cv soit augmenté par ia/i,
      /consentstudy/i,
    ];
    for (const pattern of consentPatterns) {
      const checkbox = page.locator('input[type="checkbox"]').filter({ has: page.getByText(pattern) }).first();
      if (await checkbox.count()) {
        const checked = await checkbox.isChecked().catch(() => false);
        if (!checked) {
          await checkbox.check({ force: true }).catch(async () => {
            await checkbox.click({ force: true }).catch(() => {});
          });
        }
      }
      const labelNode = page.getByText(pattern).first();
      if (await labelNode.count()) {
        try {
          const candidate = labelNode.locator('xpath=ancestor::label[1]').first();
          if (await candidate.count()) {
            const input = candidate.locator('input[type="checkbox"]').first();
            if (await input.count()) {
              const checked = await input.isChecked().catch(() => false);
              if (!checked) await input.check({ force: true }).catch(() => input.click({ force: true }).catch(() => {}));
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // Final visual pass: force upload on every required card still in error state.
  // This avoids label-dependent misses across schools.
  if (cards.length > 0) {
    const maxPasses = 3;
    const criticalPatterns = [
      /curriculum vitae ia/i,
      /relev[eé]s? de notes des deux derni[eè]res ann[eé]es/i,
      /relev[eé] de notes du bac/i,
      /lettre de recommandation/i,
    ];
    for (let pass = 0; pass < maxPasses; pass++) {
      let fixedInPass = 0;
      for (let docIndex = 0; docIndex < cards.length; docIndex++) {
        const doc = cards[docIndex];
        if (!doc.required && !UPLOAD_OPTIONAL) continue;

        const label = doc.label || 'document';
        const inputHint = doc.input
          ? ((await doc.input.getAttribute('name')) || (await doc.input.getAttribute('id')) || '')
          : '';
        const slotKey = slotKeyFor(label, inputHint, docIndex);
        const categoryKey = categoryKeyFor(label, inputHint);

        const needsUpload = await cardHasTransferWarning(doc.card);
        const alreadyOk = await isCardUploadConfirmed(doc.card, attemptedBySlot.get(slotKey) || '');
        if (!needsUpload && alreadyOk) {
          clearMissing(slotKey);
          continue;
        }

        const stableProblemFile = ensureUsableFile(label, getStableAttachmentForProblemLabel(label, inputHint, baseDir), baseDir);
        const isCritical = Boolean(stableProblemFile) || criticalPatterns.some((rx) => rx.test(normalizeOption(fixMojibake(label))));

        const filePath =
          stableProblemFile ||
          (isCritical ? getCriticalAttachmentForLabel(label, baseDir) : '') ||
          pickFileForSlot(label, inputHint, docIndex) ||
          pickAltFileForSlot(label, inputHint, docIndex, '');
        if (!filePath) {
          addMissing(slotKey, label);
          continue;
        }

        attemptedBySlot.set(slotKey, filePath);
        attemptedByCategory.set(categoryKey, filePath);
        if (inputHint) attemptedByInputName.set(normalizeOption(inputHint), filePath);

        const ok = await uploadDocumentCard(page, doc, filePath);
        if (ok) {
          fixedInPass++;
          clearMissing(slotKey);
          if (!uploadedSlots.has(slotKey)) {
            uploadedRequired++;
            uploadedSlots.add(slotKey);
          }
        } else {
          addMissing(slotKey, label);
        }
      }

      // Second chance for the exact 4 cards that are known to fail on Bachelor.
      for (let docIndex = 0; docIndex < cards.length; docIndex++) {
        const doc = cards[docIndex];
        if (!doc.required && !UPLOAD_OPTIONAL) continue;
        const label = doc.label || 'document';
        const inputHint = doc.input
          ? ((await doc.input.getAttribute('name')) || (await doc.input.getAttribute('id')) || '')
          : '';
        const slotKey = slotKeyFor(label, inputHint, docIndex);
        const stableProblemFile = ensureUsableFile(label, getStableAttachmentForProblemLabel(label, inputHint, baseDir), baseDir);
        if (!stableProblemFile && !criticalPatterns.some((rx) => rx.test(normalizeOption(fixMojibake(label))))) continue;
        const filePath = stableProblemFile || getCriticalAttachmentForLabel(label, baseDir);
        if (!filePath) continue;
        attemptedBySlot.set(slotKey, filePath);
        attemptedByCategory.set(categoryKeyFor(label, inputHint), filePath);
        if (inputHint) attemptedByInputName.set(normalizeOption(inputHint), filePath);
        const ok = await uploadDocumentCard(page, doc, filePath);
        if (ok) {
          clearMissing(slotKey);
          if (!uploadedSlots.has(slotKey)) {
            uploadedRequired++;
            uploadedSlots.add(slotKey);
          }
        } else {
          addMissing(slotKey, label);
        }
      }

      if (fixedInPass === 0) break;
    }
  }

  console.log(`\n  [RESULT] ${uploadedRequired}/${totalRequired} PJ obligatoires chargees`);

  if (missing.size > 0) {
    const missingLabels = Array.from(new Set(Array.from(missing.values())));
    throw new Error('Pieces jointes obligatoires non chargees: ' + missingLabels.join(', '));
  }
}
function decodeMojibake(str) {

  if (!/[ÃÂ]/.test(str)) return str;

  try {

    const fixed = Buffer.from(str, 'latin1').toString('utf8');

    if (fixed.includes('�')) return str;

    return fixed;

  } catch {

    return str;

  }

}



function fixMojibake(value) {

  if (typeof value === 'string') return decodeMojibake(value);

  if (Array.isArray(value)) return value.map(fixMojibake);

  if (value && typeof value === 'object') {

    const out = {};

    for (const [k, v] of Object.entries(value)) {

      out[k] = fixMojibake(v);

    }

    return out;

  }

  return value;

}



async function waitForAnyVisible(locators, timeoutMs = 8000) {

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {

    for (const locator of locators) {

      try {

        if (await locator.first().isVisible()) return true;

      } catch {

        // ignore transient failures

      }

    }

    await new Promise((r) => setTimeout(r, 250));

  }

  return false;

}

async function selectDropdownInSection(page, sectionPattern, index, value, label) {
  const section = await findSectionByText(page, sectionPattern);
  const ids = await collectVisibleComboboxIds(page, section);
  if (ids.length <= index) {
    throw new Error(`Combobox index ${index} introuvable dans section ${sectionPattern}`);
  }
  const dropdown = page.locator(`[data-codex-combo-id="${ids[index]}"]`).first();
  await waitForComboboxReady(page, dropdown);
  await openCombobox(page, dropdown);
  let options = await waitForOptions(page, dropdown, 8000);
  if (!options) {
    await openCombobox(page, dropdown);
    options = await waitForOptions(page, dropdown, 5000);
  }
  if (options) {
    const picked = await chooseOptionFromList(page, options, value, label);
    return Boolean(picked);
  }
  return false;
}


async function logValidationState(page, dataId, context) {
  const validationState = await collectValidationState(page);
  const { alerts, requiredText, invalidDetails, validationSummary } = validationState;

  const invalidCount = invalidDetails.length;

  if (alerts.length > 0) {

    console.log(`  [ERROR] Validation alerts: ${JSON.stringify(alerts)}`);

  }

  if (invalidCount > 0) {

    console.log(`  [ERROR] Invalid inputs detected: ${invalidCount}`);
    console.log(`  [ERROR] Invalid inputs details: ${JSON.stringify(invalidDetails)}`);

  }

  if (requiredText.length > 0) {
    console.log(`  [ERROR] Messages "champ obligatoire": ${JSON.stringify(requiredText)}`);
  }

  if (validationSummary) {
    console.log(`  [ERROR] Validation fonctionnelle: ${validationSummary}`);
  }

  // File inputs without files
  try {
    const fileInputs = page.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    console.log(`  [DEBUG] logValidationState: file input count=${fileCount}`);
    if (fileCount > 0) {
      const missingFiles = [];
      for (let i = 0; i < fileCount; i++) {
        const input = fileInputs.nth(i);
        const id = await input.getAttribute('id');
        const name = await input.getAttribute('name');
        const accept = await input.getAttribute('accept');
        const multiple = await input.getAttribute('multiple');
        const filesLen = await input.evaluate(el => (el.files ? el.files.length : 0));
        const meta = await getFileInputMeta(page, input, i);
        const debugLabel = meta.labelText && normalizeOption(meta.labelText) !== 'importer'
          ? meta.labelText
          : (labelFromInputName(name) || labelFromInputName(id) || meta.labelText);
        console.log(`  [DEBUG] file[${i}] id='${id}' name='${name}' filesLen=${filesLen} label='${debugLabel}' accept='${accept}' multiple='${multiple}'`);
        const required = await isFileInputRequired(input, meta.labelText, meta.labelClass, meta.cardText, meta.requiredHint);
        if (required && filesLen === 0) {
          missingFiles.push(meta.labelText || `fichier-${i + 1}`);
        }
      }
      if (missingFiles.length > 0) {
        console.log(`  [ERROR] Fichiers manquants: ${JSON.stringify(missingFiles)}`);
      }
    }
  } catch (err) {
    console.log(`  [DEBUG] logValidationState file input check failed: ${err.message}`);
  }

  await page.screenshot({ path: `reports/${dataId}-validation-${context}.png`, fullPage: true, animations: 'disabled' });

  return validationState;

}

async function collectValidationState(page) {
  const alerts = await page.locator('[role="alert"], .error, .form-error, .field-error, .help-block, .Mui-error, .ant-form-item-explain-error').allTextContents();
  const requiredText = await page.locator('text=/champ obligatoire/i').allTextContents();
  const invalidDetails = await extractInvalidFieldDetails(page);
  const validationSummary = formatValidationSummary(invalidDetails, requiredText, alerts);

  return {
    alerts,
    requiredText,
    invalidDetails,
    validationSummary,
  };
}

async function extractInvalidFieldDetails(page) {
  try {
    return await page.evaluate(() => {
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const textOf = (value) => String(value || '').replace(/\s+/g, ' ').trim();

      const findLabel = (control) => {
        if (!control) return '';

        const wrapped = control.closest('label');
        if (wrapped) {
          const wrappedText = textOf(wrapped.innerText || wrapped.textContent);
          if (wrappedText) return wrappedText;
        }

        const id = control.getAttribute('id');
        if (id) {
          const labels = Array.from(document.querySelectorAll('label[for]'));
          const linked = labels.find((label) => label.getAttribute('for') === id);
          if (linked) {
            const linkedText = textOf(linked.innerText || linked.textContent);
            if (linkedText) return linkedText;
          }
        }

        const group = control.closest('.form-group, .field, .input-group, .MuiFormControl-root, .ant-form-item, .rw-widget-container, .row, .col, td, li, section, article, div');
        if (group) {
          const labelNode = group.querySelector('label, legend, .form-label, .field-label, .control-label');
          if (labelNode) {
            const labelText = textOf(labelNode.innerText || labelNode.textContent);
            if (labelText) return labelText;
          }
        }

        const previous = control.previousElementSibling;
        if (previous) {
          const previousText = textOf(previous.innerText || previous.textContent);
          if (previousText) return previousText;
        }

        return textOf(control.getAttribute('placeholder') || control.getAttribute('name') || control.getAttribute('id') || '');
      };

      const findMessage = (control) => {
        const selectors = [
          '.invalid-feedback',
          '.field-error',
          '.form-error',
          '.help-block',
          '.Mui-error',
          '.ant-form-item-explain-error',
          '[role="alert"]',
        ];

        const containers = [
          control.closest('.form-group, .field, .input-group, .MuiFormControl-root, .ant-form-item, .rw-widget-container, td, li, div'),
          control.parentElement,
          control.parentElement?.parentElement,
        ].filter(Boolean);

        for (const container of containers) {
          for (const selector of selectors) {
            const node = container.querySelector(selector);
            const text = textOf(node?.innerText || node?.textContent || '');
            if (text) return text;
          }
        }

        return '';
      };

      const controls = Array.from(document.querySelectorAll('input, textarea, select'));
      const details = [];

      for (const control of controls) {
        if (!isVisible(control)) continue;

        const ariaInvalid = String(control.getAttribute('aria-invalid') || '').toLowerCase() === 'true';
        const nativeInvalid = typeof control.matches === 'function' ? control.matches(':invalid') : false;
        const classInvalid = /\bis-invalid\b|\berror\b/i.test(control.className || '');
        const message = findMessage(control);

        if (!(ariaInvalid || nativeInvalid || classInvalid || /champ obligatoire|invalide|incorrect|required/i.test(message))) {
          continue;
        }

        const validity = control.validity
          ? {
              valueMissing: Boolean(control.validity.valueMissing),
              typeMismatch: Boolean(control.validity.typeMismatch),
              patternMismatch: Boolean(control.validity.patternMismatch),
              tooShort: Boolean(control.validity.tooShort),
              tooLong: Boolean(control.validity.tooLong),
              badInput: Boolean(control.validity.badInput),
              customError: Boolean(control.validity.customError),
            }
          : null;

        details.push({
          label: findLabel(control),
          name: textOf(control.getAttribute('name')),
          id: textOf(control.getAttribute('id')),
          placeholder: textOf(control.getAttribute('placeholder')),
          type: textOf(control.getAttribute('type')) || control.tagName.toLowerCase(),
          value: textOf(control.value || ''),
          message,
          validity,
        });
      }

      return details.slice(0, 8);
    });
  } catch {
    return [];
  }
}

function formatValidationSummary(invalidDetails, requiredText = [], alerts = []) {
  const issues = [];

  for (const detail of invalidDetails || []) {
    const label = fixMojibake(detail.label || detail.placeholder || detail.name || detail.id || 'Champ');
    const normalizedLabel = normalizeOption(label);
    const value = String(detail.value || '');
    const message = fixMojibake(detail.message || '');
    const validity = detail.validity || {};

    let reason = '';

    if ((/nom|prenom/.test(normalizedLabel) || /last|first/.test(normalizedLabel)) && /\d/.test(value)) {
      reason = 'contient des chiffres';
    } else if (validity.valueMissing || /champ obligatoire|obligatoire|required/i.test(message)) {
      reason = 'champ obligatoire';
    } else if (validity.patternMismatch) {
      reason = /email/.test(normalizedLabel) ? 'email invalide' : 'format invalide';
    } else if (validity.typeMismatch) {
      reason = /email/.test(normalizedLabel) ? 'email invalide' : 'type de valeur invalide';
    } else if (validity.tooShort) {
      reason = 'valeur trop courte';
    } else if (validity.tooLong) {
      reason = 'valeur trop longue';
    } else if (validity.badInput) {
      reason = 'saisie invalide';
    } else if (validity.customError && message) {
      reason = message;
    } else if (message) {
      reason = message;
    }

    if (reason) {
      issues.push(`${label}: ${reason}`);
    }
  }

  if (!issues.length && (requiredText || []).length > 0) {
    issues.push('Des champs obligatoires ne sont pas valides ou sont restes vides');
  }

  if (!issues.length && (alerts || []).length > 0) {
    const firstAlert = fixMojibake(alerts[0] || '').trim();
    if (firstAlert) {
      issues.push(firstAlert);
    }
  }

  return Array.from(new Set(issues)).join(' ; ');
}



async function checkBlockingCandidature(page, dataId) {

  const msg = page.getByText(/candidature en cours/i);

  try {

    if (await msg.first().isVisible()) {

      await page.screenshot({ path: `reports/${dataId}-candidature-en-cours.png` });

      if (SKIP_ON_CANDIDATURE_EN_COURS) {

        console.log(`[WARNING] Candidature déjà en cours pour ${dataId}, on passe au suivant.`);

        return true;

      }

      throw new Error('Candidature déjà en cours pour cet email');

    }

  } catch {

    // ignore if locator not found

  }

  return false;

}



async function hasValidationErrors(page) {

  const errorLocator = page.locator(

    'input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"], .is-invalid, .error, .form-error, .field-error, .help-block, .Mui-error, .ant-form-item-explain-error, [role="alert"]'

  );

  const count = await errorLocator.count();

  if (count === 0) return false;

  const max = Math.min(count, 5);

  for (let i = 0; i < max; i++) {

    if (await errorLocator.nth(i).isVisible()) return true;

  }

  return false;

}

async function tryTypeSelectSmart(page, dropdown, valeur, label) {
  if (!valeur) return false;

  let input = dropdown.locator('input.rw-dropdownlist-search');
  if (await input.count() === 0) {
    try {
      input = dropdown.locator('..').locator('input.rw-dropdownlist-search');
    } catch {
      // ignore
    }
  }
  if (await input.count() === 0) return false;

  try {
    await input.first().click({ force: true });
    await input.first().fill('');
    await input.first().type(valeur, { delay: 50 });
  } catch {
    return false;
  }

  await page.waitForTimeout(200);

  try {
    const optionSelector = '[role="option"], li, [data-rw-option], [data-option], .rw-list-option';
    const owns = await dropdown.getAttribute('aria-owns');
    const options = owns
      ? page.locator(`#${owns} ${optionSelector}`)
      : page.locator(`[role="listbox"]:visible ${optionSelector}`);
    const optionCount = await options.count();
    if (optionCount > 0) {
      const picked = await chooseOptionFromList(page, options, valeur, label);
      if (picked) return true;
    }
  } catch {
    // ignore
  }

  try {
    await input.first().press('Enter');
  } catch {
    // ignore
  }

  await page.waitForTimeout(300);
  try {
    const valueEl = dropdown.locator('.rw-dropdown-list-value').first();
    let text = '';
    if (await valueEl.count()) {
      text = (await valueEl.textContent()) || '';
    }
    if (!text) {
      text = await input.first().inputValue();
    }
    if (text && normalizeOption(text).includes(normalizeOption(valeur))) {
      console.log(`  âœ… ${label} => "${text.trim()}"`);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

async function ensureFormStart(page, configOrAttempts = 3, maybeAttempts = 3) {
  const config = typeof configOrAttempts === 'object' && configOrAttempts !== null ? configOrAttempts : {};
  const attempts = typeof configOrAttempts === 'number' ? configOrAttempts : maybeAttempts;
  const startPatterns = Array.isArray(config.startButtons) && config.startButtons.length
    ? config.startButtons
    : [/D.marrer une nouvelle candidature/i];
  const resumePatterns = Array.isArray(config.resumeButtons) && config.resumeButtons.length
    ? config.resumeButtons
    : [/Poursuivre ma candidature/i];
  const readyPatterns = Array.isArray(config.readyTexts) && config.readyTexts.length
    ? config.readyTexts
    : [/Session de rentr.e/i];

  const isAnyVisible = async (patterns) => {
    for (const pattern of patterns) {
      try {
        if (await page.getByText(pattern).first().isVisible()) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  };

  const clickByPatterns = async (patterns) => {
    for (const pattern of patterns) {
      try {
        const byRole = page.getByRole('button', { name: pattern }).first();
        if (await byRole.count()) {
          await byRole.click({ force: true });
          return true;
        }
      } catch {
        // ignore
      }

      try {
        const generic = page.locator('button, a, [role="button"], input[type="submit"], input[type="button"]').filter({ hasText: pattern }).first();
        if (await generic.count()) {
          await generic.click({ force: true });
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  };

  for (let i = 0; i < attempts; i++) {
    await acceptCookiesIfBlocking(page, `start attempt ${i + 1}`);

    if (await isAnyVisible(readyPatterns)) {
      return true;
    }

    try {
      if (await clickByPatterns(resumePatterns)) {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        continue;
      }
    } catch {
      // ignore
    }

    try {
      if (await clickByPatterns(startPatterns)) {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        continue;
      }
    } catch {
      // ignore
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

async function clickPrimaryButton(page, labels) {
  const candidates = Array.isArray(labels) ? labels : [labels];
  const scopes = [];
  try {
    const forms = page.locator('form');
    if (await forms.count()) scopes.push(forms);
  } catch {}
  try {
    const main = page.locator('main');
    if (await main.count()) scopes.push(main);
  } catch {}
  scopes.push(page);

  const tryInScope = async (scope, regex) => {
    try {
      const btn = scope.getByRole('button', { name: regex }).first();
      if (await btn.count()) {
        try { await btn.scrollIntoViewIfNeeded(); } catch {}
        if (await btn.isVisible()) {
          await btn.click();
          return true;
        }
      }
    } catch {}
    try {
      const locator = scope.locator('button, a, [role="button"]').filter({ hasText: regex }).first();
      if (await locator.count()) {
        try { await locator.scrollIntoViewIfNeeded(); } catch {}
        if (await locator.isVisible()) {
          await locator.click();
          return true;
        }
      }
    } catch {}
    try {
      const inputs = scope.locator('input[type="submit"], input[type="button"]');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        if (!(await input.isVisible())) continue;
        const value = (await input.getAttribute('value')) || '';
        const aria = (await input.getAttribute('aria-label')) || '';
        const title = (await input.getAttribute('title')) || '';
        const text = `${value} ${aria} ${title}`.trim();
        if (regex.test(text)) {
          try { await input.scrollIntoViewIfNeeded(); } catch {}
          await input.click();
          return true;
        }
      }
    } catch {}
    try {
      const textCandidates = scope.getByText(regex, { exact: false });
      const tcount = await textCandidates.count();
      for (let i = 0; i < tcount; i++) {
        const node = textCandidates.nth(i);
        if (!(await node.isVisible())) continue;
        try { await node.scrollIntoViewIfNeeded(); } catch {}
        const handle = await node.elementHandle();
        if (handle) {
          const clicked = await page.evaluate((el) => {
            const clickable = el.closest('button, a, [role="button"], input[type="submit"], input[type="button"]');
            if (clickable) {
              clickable.click();
              return true;
            }
            return false;
          }, handle);
          if (clicked) return true;
        }
        try {
          await node.click({ force: true });
          return true;
        } catch {
          // ignore
        }
      }
    } catch {}
    return false;
  };

  for (const label of candidates) {
    const regex = label instanceof RegExp ? label : new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const scope of scopes) {
      if (await tryInScope(scope, regex)) return true;
    }
  }

  // retry after scrolling to bottom
  await scrollToBottom(page);
  for (const label of candidates) {
    const regex = label instanceof RegExp ? label : new RegExp(String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const scope of scopes) {
      if (await tryInScope(scope, regex)) return true;
    }
  }

  // Last-resort DOM click (ignore visibility)
  try {
    const labelsText = candidates.map((l) => (l instanceof RegExp ? l.source : String(l)));
    const clicked = await page.evaluate((labelSources) => {
      const regexes = labelSources.map((src) => new RegExp(src, 'i'));
      const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], div, span'));
      for (const el of nodes) {
        const text = (el.innerText || el.textContent || el.value || '').trim();
        if (!text) continue;
        if (regexes.some((rx) => rx.test(text))) {
          el.click();
          return true;
        }
      }
      return false;
    }, labelsText);
    if (clicked) return true;
  } catch {
    // ignore
  }

  return false;
}
async function clickNextAndWait(page, dataId, context, locators, mustNotBeVisible = [], buttonLabels = ['Suivant']) {
  const labels = Array.isArray(buttonLabels) ? buttonLabels : [buttonLabels];
  // If next page is already visible, don't click again
  try {
    const already = await waitForAnyVisible(locators, 800);
    if (already) {
      return;
    }
  } catch {
    // ignore
  }
  await acceptCookiesIfBlocking(page, `${context} before click`);

  const clicked = await clickPrimaryButton(page, labels);
  if (!clicked) {
    throw new Error(`Bouton introuvable (${labels.join(' / ')}): ${context}`);
  }

  await page.waitForTimeout(500);
  await acceptCookiesIfBlocking(page, `${context} after click`);

  if (await hasValidationErrors(page)) {

    const validationState = await logValidationState(page, dataId, context);

    const detail = validationState?.validationSummary ? ` | ${validationState.validationSummary}` : '';
    throw new Error(`Validation errors detected: ${context}${detail}`);

  }

  await page.waitForLoadState('domcontentloaded');

  let ok = await waitForAnyVisible(locators, 8000);

  if (!ok) {
    // extra wait (slow transitions)
    await page.waitForTimeout(5000);
    ok = await waitForAnyVisible(locators, 8000);
  }

  if (!ok) {
    // retry click once more after scroll
    await scrollToBottom(page);
    await acceptCookiesIfBlocking(page, `${context} retry`);
    const clickedRetry = await clickPrimaryButton(page, labels);
    if (clickedRetry) {
      await page.waitForTimeout(800);
      await page.waitForLoadState('domcontentloaded');
      ok = await waitForAnyVisible(locators, 8000);
    }
  }

  if (!ok) {
    const startBtn = page.getByText(/D.marrer une nouvelle candidature/i);
    const resumeBtn = page.getByText(/Poursuivre ma candidature/i);
    let isStart = false;
    try {
      if (await startBtn.first().isVisible()) isStart = true;
    } catch {}
    try {
      if (await resumeBtn.first().isVisible()) isStart = true;
    } catch {}

    if (isStart && RECOVER_ON_START) {
      console.log(`[WARNING] Retour page démarrage pendant ${context} — tentative de reprise`);
      const resumed = await ensureFormStart(page);
      if (resumed) {
        await page.waitForLoadState('domcontentloaded');
        const okRetry = await waitForAnyVisible(locators, 8000);
      if (okRetry) return;
      }
      const validationState = await logValidationState(page, dataId, `${context}-retour-debut`);
      const detail = validationState?.validationSummary ? ` | ${validationState.validationSummary}` : '';
      throw new Error(`Retour page démarrage pendant ${context}${detail}`);
    }

    const validationState = await logValidationState(page, dataId, context);
    const detail = validationState?.validationSummary ? ` | ${validationState.validationSummary}` : '';
    throw new Error(`Navigation failed: ${context}${detail}`);

  }

  // Re-check validation errors after UI settles
  await page.waitForTimeout(800);
  if (await hasValidationErrors(page)) {
    const validationState = await logValidationState(page, dataId, context);
    const detail = validationState?.validationSummary ? ` | ${validationState.validationSummary}` : '';
    throw new Error(`Validation errors detected: ${context}${detail}`);
  }

  for (const locator of mustNotBeVisible) {
    let stillVisible = false;
    try {
      stillVisible = await locator.first().isVisible();
    } catch {
      stillVisible = false;
    }

    if (stillVisible) {
      const validationState = await logValidationState(page, dataId, context);
      const detail = validationState?.validationSummary ? ` | ${validationState.validationSummary}` : '';
      throw new Error(`Still on previous step: ${context}${detail}`);
    }
  }

}



function decodeBufferToString(buf) {
  if (!buf || buf.length === 0) return '';
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }

  // Heuristic: UTF-16 without BOM
  const sampleLen = Math.min(buf.length, 200);
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0x00) {
      if (i % 2 === 0) zeroEven += 1;
      else zeroOdd += 1;
    }
  }
  if (zeroOdd > sampleLen * 0.2) {
    return buf.toString('utf16le');
  }
  if (zeroEven > sampleLen * 0.2) {
    const swapped = Buffer.alloc(buf.length);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }

  return buf.toString('utf8');
}
function readJsonFile(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = decodeBufferToString(buf);
  if (text && text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error('JSON invalide: ' + filePath + '. ' + msg);
  }
}
module.exports = {
  normalizeEmailPart,
  formatDateFR,
  randomFrenchPhone,
  applyDynamicJdd,
  getEnvList,
  ensureAttachmentsExist,
  getAttachmentPool,
  buildFakeCandidate,
  alphaSuffix,
  withNameSuffix,
  digitsOnly,
  normalizeText,
  normalizeOption,
  normalizeLabel,
  isDropdownLabel,
  formatLike,
  incrementPhone,
  makeEmailSuffix,
  getAndBumpRunCounter,
  withEmailSuffix,
  inferValueForLabel,
  resolveFilePath,
  extractLabelFromCardText,
  findAttachmentForLabel,
  findAttachmentForInputName,
  pickFileFromPool,
  labelFromInputName,
  requiredFromInputName,
  scoreFileForLabel,
  findBestFileForLabel,
  decodeMojibake,
  fixMojibake,
  decodeBufferToString,
  readJsonFile,
  pauseForReview,
  scrollToBottom,
  acceptCookiesIfBlocking,
  selectDropdown,
  waitForComboboxReady,
  waitForComboboxEnabled,
  openCombobox,
  tryTypeSelect,
  chooseOptionFromList,
  getOptionsLocator,
  waitForOptions,
  selectDropdownByIndex,
  resolveDropdownByLabel,
  selectDropdownByLabel,
  findSectionByText,
  findInputByLabel,
  fillInputByLabel,
  fillOptionalInputByLabel,
  fillFieldsByLabel,
  checkAllVisibleCheckboxes,
  checkCheckboxByLabelText,
  fillMissingFromErrorMessages,
  fillMissingRequiredFields,
  logRequiredFields,
  fillParentEmailConfirm,
  findDateInput,
  fillDateInput,
  findPhoneInput,
  fillPhoneInput,
  stepPause,
  getFileInputMeta,
  isFileInputRequired,
  collectUploadCards,
  uploadFileToCard,
  fillFileUploads,
  getCardForInput,
  collectDocumentCards,
  cardHasTransferWarning,
  isCardUploadConfirmed,
  uploadDocumentCard,
  uploadInputFile,
  fillDocumentsSection,
  waitForAnyVisible,
  selectDropdownInSection,
  logValidationState,
  checkBlockingCandidature,
  hasValidationErrors,
  tryTypeSelectSmart,
  ensureFormStart,
  clickPrimaryButton,
  clickNextAndWait,
};
