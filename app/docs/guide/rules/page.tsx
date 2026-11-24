import { GuidePrevNext } from "@/components/docs/GuidePrevNext";

const CODE = "bg-slate-200 dark:bg-slate-600 px-1 rounded-sm text-xs";

const TERMS: [string, string][] = [
  ["rule:appliesTo", "The class the rule checks. Instances of its subclasses are checked too."],
  ["rule:property", "The property whose values are checked. Only a closed rule may leave it out."],
  ["rule:minCount, rule:maxCount", "The fewest and most values the property may have on each instance."],
  ["rule:valueClass", "Each value must be an instance of this class."],
  ["rule:valueDatatype", "Each value must be a literal of this datatype, such as xsd:integer."],
  ["rule:allowedValues", "A list of the only values the property may have."],
  ["rule:pattern", "A regular expression each value must match."],
  ["rule:minLength, rule:maxLength", "The fewest and most characters each value may have."],
  ["rule:closed", "When true, instances may use only the properties that have a rule for the class, besides rdf:type and annotation properties such as rdfs:label and rdfs:comment."],
  ["rule:severity", "rule:Error (the default), rule:Warning or rule:Info."],
  ["rdfs:comment", "The message shown for a violation. Without one, OntoBuild writes a plain message."],
];

export default function RulesPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
        What are Rules?
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-8">
        OWL describes what follows from your data; it does not reject data that looks wrong. Rules{" "}
        do: each one states what the instances of a class must look like, and OntoBuild reports every{" "}
        instance that breaks it.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
            Rules Live in the Ontology
          </h2>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400 mb-3">
              A rule is a named term of the class <code className={CODE}>rule:Rule</code>, written in{" "}
              the ontology file next to the classes it checks. Its vocabulary ships with OntoBuild as the{" "}
              ontology <code className={CODE}>https://ontobuild.dev/rules</code>; the first rule you add{" "}
              imports it and declares the <code className={CODE}>rule:</code> prefix. Rules are edited{" "}
              from the class form, or by the agent, and each change is a commit like any other edit.
            </p>
            <div className="bg-slate-900 text-slate-100 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              <pre>{`@prefix rule: <https://ontobuild.dev/rules#> .

:rule-Book-isbn a rule:Rule ;
    rdfs:comment "Every book needs one ISBN of 13 digits" ;
    rule:appliesTo :Book ;
    rule:property :isbn ;
    rule:minCount 1 ;
    rule:maxCount 1 ;
    rule:pattern "^[0-9]{13}$" .

:rule-Book-closed a rule:Rule ;
    rule:appliesTo :Book ;
    rule:closed true ;
    rule:severity rule:Warning .`}</pre>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
            The Terms
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Term</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-slate-900 dark:text-white">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {TERMS.map(([term, meaning]) => (
                  <tr key={term}>
                    <td className="px-4 py-3 text-slate-900 dark:text-white font-medium font-mono whitespace-nowrap">{term}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-4">
            How Rules are Checked
          </h2>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700 space-y-3">
            <p className="text-slate-600 dark:text-slate-400">
              OntoBuild turns the rules into{" "}
              <a href="https://www.w3.org/TR/shacl/" className="text-blue-600 dark:text-blue-400 hover:underline">SHACL</a>{" "}
              shapes, one shape per class, and validates the ontology together with everything it{" "}
              imports. Rules in an imported ontology apply too, and are read-only here. The shapes are{" "}
              never stored: they are worked out each time, and you can download them as Turtle with{" "}
              <strong>Download SHACL</strong> in the Health tab&apos;s Rules view, or from{" "}
              <code className={CODE}>GET /api/v1/projects/&#123;id&#125;/rules/shacl</code>.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              Validation runs after every commit and on demand. Its violations appear in the{" "}
              <strong>Health</strong> tab and in the Agent tab&apos;s health counts, so{" "}
              <strong>Fix issues</strong> asks the agent to fix them along with the other checks.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              A pull request lists the violations its branch adds that the target branch does not{" "}
              have, and it cannot be merged until that list is empty.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              A closed rule on a class also checks the instances of its subclasses, so a property that{" "}
              only a subclass uses needs a rule on the closed class too.
            </p>
          </div>
        </section>
      </div>

      <GuidePrevNext currentSlug="rules" />
    </div>
  );
}
