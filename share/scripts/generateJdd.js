const { faker } = require('@faker-js/faker/locale/fr');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../data/jdd');
const ATTACHMENTS_DIR = path.join(__dirname, '../data/attachments');

const DEFAULT_SESSIONS = ['Septembre / Octobre 2026', 'Février / Mars 2026'];
const DEFAULT_CAMPUSES = ['Paris'];
const DEFAULT_PROGRAMMES = ['Banque Assurance - Resp en gestion financière', 'Bachelor Marketing'];
const DEFAULT_NIVEAUX = ['Bachelor 1ère année'];

const SESSIONS = process.env.SESSIONS
  ? process.env.SESSIONS.split(',').map((v) => v.trim()).filter(Boolean)
  : DEFAULT_SESSIONS;
const CAMPUSES = process.env.CAMPUSES
  ? process.env.CAMPUSES.split(',').map((v) => v.trim()).filter(Boolean)
  : DEFAULT_CAMPUSES;
const PROGRAMMES = process.env.PROGRAMMES
  ? process.env.PROGRAMMES.split(',').map((v) => v.trim()).filter(Boolean)
  : DEFAULT_PROGRAMMES;

const ATTACHMENTS = {
  "Pièce d'identité (recto)": 'attachments/piece_identite_recto.pdf',
  "Pièce d'identité (verso)": 'attachments/piece_identite_verso.pdf',
  'Relevé de notes du BAC': 'attachments/bulletins_notes.pdf',
  'Deux derniers bulletins de notes': 'attachments/bulletins_notes.pdf',
  'Dernier diplôme obtenu': 'attachments/dernier_diplome.pdf',
  'Curriculum vitae': 'attachments/cv.pdf',
  'Lettre de motivation': 'attachments/lettre_motivation.pdf',
  'Attestation de scolarité': 'attachments/attestation_scolarite.pdf',
};

function formatDateFr(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function ensureAttachments() {
  const missing = [];
  for (const rel of Object.values(ATTACHMENTS)) {
    const abs = path.join(ATTACHMENTS_DIR, path.basename(rel));
    if (!fs.existsSync(abs)) {
      missing.push(abs);
    }
  }
  if (missing.length > 0) {
    console.error('[ERROR] Fichiers PJ manquants :');
    for (const m of missing) console.error(`  - ${m}`);
    console.error('Copie tes fichiers dans data\\attachments puis relance.');
    process.exit(1);
  }
}

function generateCandidate(index) {
  const prenom = faker.person.firstName();
  const nom = faker.person.lastName();
  const email = faker.internet.email({ firstName: prenom, lastName: nom }).toLowerCase();
  const emailParent = faker.internet.email().toLowerCase();
  const dob = faker.date.birthdate({ min: 17, max: 22, mode: 'age' });

  return {
    id: `candidat-${String(index).padStart(2, '0')}`,
    url: 'https://prospect.rec.omneseducation.com/app/bachelorsinseec/program',
    page1: {
      session: faker.helpers.arrayElement(SESSIONS),
      campus: faker.helpers.arrayElement(CAMPUSES),
      niveau_admission: faker.helpers.arrayElement(DEFAULT_NIVEAUX),
      programme: faker.helpers.arrayElement(PROGRAMMES),
      nom,
      prenom,
      date_naissance: formatDateFr(dob),
      email,
      email_confirm: email,
      telephone: '06' + faker.string.numeric(8),
      pays: 'France',
      nationalite: 'Française',
      email_parent: emailParent,
      email_parent_confirm: emailParent,
      telephone_parent: '06' + faker.string.numeric(8),
    },
    page2: {
      niveau_etude: faker.helpers.arrayElement(['Terminale', 'Bac+1', 'Bac+2']),
      type_etude: faker.helpers.arrayElement(['Générale', 'Technologique', 'Professionnelle']),
      session_admission: faker.helpers.arrayElement(SESSIONS),
      attachments: ATTACHMENTS,
    },
  };
}

function getCountArg() {
  const idx = process.argv.findIndex((arg) => arg === '--count' || arg === '-n');
  if (idx === -1) return 14;
  const raw = process.argv[idx + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

function main() {
  const count = getCountArg();
  ensureAttachments();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[INFO] Génération de ${count} candidats dans ${OUTPUT_DIR}`);
  for (let i = 1; i <= count; i += 1) {
    const candidat = generateCandidate(i);
    const filePath = path.join(OUTPUT_DIR, `${candidat.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(candidat, null, 2), 'utf-8');
    console.log(`  - ${path.basename(filePath)} (${candidat.page1.prenom} ${candidat.page1.nom})`);
  }
}

main();
