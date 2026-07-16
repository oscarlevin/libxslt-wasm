import { expect, test } from "@jest/globals";

import { XmlDocument } from "./XmlDocument.ts";
import { XsltStylesheet } from "./XsltStylesheet.ts";

// > baseline crash threshold (64 KB stack traps at depth 100) and comfortably
// below both the fixed build's ceiling and libxslt's xsltMaxDepth (3000).
const DEPTH = 500;

const STYLESHEET = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="@*|node()">
    <xsl:copy><xsl:apply-templates select="@*|node()"/></xsl:copy>
  </xsl:template>
</xsl:stylesheet>`;

test(`deeply nested (${DEPTH}) transform does not overflow the WASM stack`, async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<root>${"<a>".repeat(DEPTH)}x${"</a>".repeat(DEPTH)}</root>\n`;
  // libxml2's own parser depth guard rejects documents nested past 256
  // levels unless XML_PARSE_HUGE is set; that guard is unrelated to the WASM
  // stack size and would otherwise mask the behavior this test checks.
  using doc = await XmlDocument.fromString(xml, { options: { huge: true } });
  using sheet = await XsltStylesheet.fromString(STYLESHEET);
  using result = await sheet.apply(doc);
  expect(result.toString().length).toBeGreaterThan(DEPTH); // completes, no trap
});
