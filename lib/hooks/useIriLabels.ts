import { useState, useEffect, useRef } from "react";
import { projectOntologyApi } from "@/lib/api/client";
import { getPreferredLabel, getLocalName } from "@/lib/utils";

const EXTERNAL_VOCABULARY_AUTHORITIES_AND_PATHS: readonly string[] = [
  "www.w3.org/1999/02/22-rdf-syntax-ns#",
  "www.w3.org/2000/01/rdf-schema#",
  "www.w3.org/2001/XMLSchema#",
  "www.w3.org/2002/07/owl#",
  "www.w3.org/2004/02/skos/core#",
  "purl.org/dc/elements/1.1/",
  "purl.org/dc/terms/",
  "xmlns.com/foaf/0.1/",
  "www.w3.org/ns/prov#",
];

function isExternalVocabularyIri(iri: string): boolean {
  let rest: string;
  if (iri.startsWith("http://")) rest = iri.slice("http://".length);
  else if (iri.startsWith("https://")) rest = iri.slice("https://".length);
  else return false;
  for (const suffix of EXTERNAL_VOCABULARY_AUTHORITIES_AND_PATHS) {
    if (rest.startsWith(suffix)) return true;
  }
  return false;
}

export function useIriLabels(
  iris: string[],
  opts: {
    projectId: string;
    accessToken?: string;
    branch?: string;
    labelHints?: Record<string, string>;
  },
): Record<string, string> {
  const { projectId, accessToken, branch, labelHints } = opts;
  const [labels, setLabels] = useState<Record<string, string>>({});
  const pendingRef = useRef(new Set<string>());
  const contextRef = useRef("");

  const contextKey = `${projectId}|${branch ?? ""}`;
  useEffect(() => {
    if (contextRef.current !== contextKey) {
      contextRef.current = contextKey;
      setLabels({});
      pendingRef.current = new Set<string>();
    }
  }, [contextKey]);

  useEffect(() => {
    const unique = [...new Set(iris.filter(Boolean))];
    const unresolved = unique.filter(
      (iri) => !labels[iri] && !pendingRef.current.has(iri) && !(labelHints && labelHints[iri]),
    );
    if (unresolved.length === 0) return;

    for (const iri of unresolved) pendingRef.current.add(iri);

    let cancelled = false;

    const resolve = async () => {
      const newLabels: Record<string, string> = {};

      for (let i = 0; i < unresolved.length; i += 10) {
        const batch = unresolved.slice(i, i + 10);
        await Promise.all(
          batch.map(async (iri) => {
            if (isExternalVocabularyIri(iri)) return;

            try {
              const localName = getLocalName(iri);
              const result = await projectOntologyApi.searchEntities(
                projectId, localName, accessToken, branch,
              );
              const match = result.results.find(
                (r: { iri: string; label?: string }) => r.iri === iri,
              );
              if (match?.label) { newLabels[iri] = match.label; return; }
            } catch {
            }

            try {
              const detail = await projectOntologyApi.getClassDetail(
                projectId, iri, accessToken, branch,
              );
              const label = getPreferredLabel(detail.labels);
              if (label) { newLabels[iri] = label; return; }
            } catch {
            }
          }),
        );
      }

      if (!cancelled && Object.keys(newLabels).length > 0) {
        setLabels((prev) => ({ ...prev, ...newLabels }));
      }

      for (const iri of unresolved) pendingRef.current.delete(iri);
    };

    resolve();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iris.join(","), projectId, accessToken, branch]);

  return labelHints ? { ...labelHints, ...labels } : labels;
}
