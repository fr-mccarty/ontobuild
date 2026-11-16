// Shared by the import endpoint (server/rdf.ts) and the upload picker so the two accept the
// same files.
export type RdfFormat = "turtle" | "n3" | "ntriples" | "nquads" | "trig" | "rdfxml" | "jsonld";

export const RDF_EXTENSION_FORMATS: Record<string, RdfFormat> = {
  ".ttl": "turtle",
  ".n3": "n3",
  ".nt": "ntriples",
  ".nq": "nquads",
  ".trig": "trig",
  ".owl": "rdfxml",
  ".rdf": "rdfxml",
  ".xml": "rdfxml",
  ".jsonld": "jsonld",
  ".json": "jsonld",
};

export const RDF_FILE_EXTENSIONS = Object.keys(RDF_EXTENSION_FORMATS);
