const terms = /\b(if|unless|when|whenever|before|after|until|while|only if|as soon as|even if|except when)\b/gi
export function parseConditions(text) {
  const conditions = []; const restrictions = []
  for (const sentence of text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean)) {
    const m = sentence.match(terms); if (m) conditions.push({ operator: m[0].toLowerCase(), expression: sentence })
    if (/\b(?:do not|don't|never|avoid|without|must not)\b/i.test(sentence)) restrictions.push(sentence)
  }
  return { conditions, restrictions }
}
