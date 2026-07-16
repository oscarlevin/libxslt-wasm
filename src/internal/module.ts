import libxsltFactory from "@pretextbook/libxslt-wasm/output/libxslt";

const libxslt = await libxsltFactory();

export { libxsltFactory, libxslt };
