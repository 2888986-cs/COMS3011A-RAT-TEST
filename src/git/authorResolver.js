/**
 * Author identity resolution.
 *
 * A single person can appear as several raw git identities (different emails
 * or name spellings). Resolution happens in two stages:
 *   1. .mailmap entries (if the repository provides one)
 *   2. manual merge groups created by the user (fallback when no mailmap exists)
 *
 * Each resolved author gets a stable id:
 *   - standalone author -> lowercased canonical email
 *   - manually merged group -> the group's generated id
 */
function createAuthorResolver({ commits = [], mailmapEntries = [], manualMerges = [] }) {
  // Index mailmap entries by source email.
  const mailByEmail = new Map();
  for (const entry of mailmapEntries) {
    if (!entry.sourceEmail) continue;
    if (!mailByEmail.has(entry.sourceEmail)) mailByEmail.set(entry.sourceEmail, []);
    mailByEmail.get(entry.sourceEmail).push(entry);
  }

  // Index manual merge groups by member email.
  const groupByEmail = new Map();
  for (const group of manualMerges) {
    for (const email of group.emails || []) {
      groupByEmail.set(String(email).toLowerCase(), group);
    }
  }

  function resolveIdentity(name, emailRaw) {
    const email = (emailRaw || '').toLowerCase();
    let resolvedName = name || email;
    let resolvedEmail = email;

    const candidates = mailByEmail.get(email);
    if (candidates) {
      for (const entry of candidates) {
        if (entry.sourceName && entry.sourceName !== resolvedName) continue;
        if (entry.targetName) resolvedName = entry.targetName;
        if (entry.targetEmail) resolvedEmail = entry.targetEmail;
        break;
      }
    }

    const group = groupByEmail.get(resolvedEmail);
    if (group) {
      return { id: group.id, name: group.name || resolvedEmail, email: resolvedEmail };
    }
    return { id: resolvedEmail, name: resolvedName, email: resolvedEmail };
  }

  // Memoised per raw identity so large histories resolve quickly.
  const commitMemo = new Map();
  function resolveCommit(commit) {
    const key = `${commit.authorEmail}\u0000${commit.authorName}`;
    let id = commitMemo.get(key);
    if (id === undefined) {
      id = resolveIdentity(commit.authorName, commit.authorEmail).id;
      commitMemo.set(key, id);
    }
    return id;
  }

  // Aggregate raw identity variants across the whole history.
  const variants = new Map();
  for (const commit of commits) {
    const key = `${commit.authorEmail}\u0000${commit.authorName}`;
    let variant = variants.get(key);
    if (!variant) {
      variant = { name: commit.authorName, email: commit.authorEmail, commitCount: 0 };
      variants.set(key, variant);
    }
    variant.commitCount++;
  }

  const authorsById = new Map();
  for (const variant of variants.values()) {
    const identity = resolveIdentity(variant.name, variant.email);
    let author = authorsById.get(identity.id);
    if (!author) {
      author = { id: identity.id, name: identity.name, emails: [], commitCount: 0, raw: [] };
      authorsById.set(identity.id, author);
    }
    if (!author.emails.includes(identity.email)) author.emails.push(identity.email);
    author.commitCount += variant.commitCount;
    author.raw.push({
      name: variant.name,
      email: variant.email,
      commitCount: variant.commitCount,
      mailmapApplied: identity.email !== variant.email || identity.name !== variant.name,
    });
  }

  const authors = [...authorsById.values()].sort((a, b) => b.commitCount - a.commitCount);
  const nameById = new Map(authors.map((a) => [a.id, a.name]));

  function authorName(id) {
    return nameById.get(id) || id;
  }

  return { authors, resolveCommit, authorName };
}

module.exports = { createAuthorResolver };
