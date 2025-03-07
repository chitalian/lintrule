import * as colors from "https://deno.land/std@0.185.0/fmt/colors.ts";

export function parseDiffToHunks(diff: string) {
  const lines = diff.split("\n");
  const hunks = [];
  let currentFile = "";

  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      // It's the file name line
      currentFile = line.slice(4); // Remove the '+++ ' prefix
    } else if (line.startsWith("@@ ")) {
      // It's a hunk header
      const hunkHeader = line.slice(2).trim(); // Remove the '@@ ' prefix
      const [oldFile, newFile] = hunkHeader.split(" ");

      const [x, y] = oldFile.slice(1).split(",").map(Number); // Remove the '-' prefix and convert to numbers
      const [z, w] = newFile.slice(1).split(",").map(Number); // Remove the '+' prefix and convert to numbers

      hunks.push({
        file: currentFile.replace("b/", "").replace("a/", ""),
        x,
        y,
        z,
        w,
      });
    }
  }

  return hunks;
}

export function parseDiffToFiles(diff: string) {
  const diffParts = diff.split("diff --git");
  const result = [];

  for (const part of diffParts) {
    if (part.trim() === "") continue;

    const match = part.match(/ a\/(.*) b\/(.*)/);
    if (!match) continue;

    const filePath = match[1];

    const diffContentStart = part.indexOf("---");
    const nextLineStart = part.indexOf("+++");
    if (diffContentStart === -1 || nextLineStart === -1) continue;

    // Ignore if the file is deleted (next line is +++ /dev/null)
    const nextLine = part.slice(
      nextLineStart,
      part.indexOf("\n", nextLineStart)
    );
    if (nextLine.trim() === "+++ /dev/null") continue;

    const diffContent = part.slice(diffContentStart);

    result.push({
      file: filePath,
      diff: diffContent,
    });
  }

  return result;
}

export async function getDiffInGithubActionPullRequest() {
  const head = Deno.env.get("GITHUB_HEAD_REF");
  if (!head) {
    throw new Error("GITHUB_HEAD_REF is not defined");
  }
  const ref = Deno.env.get("GITHUB_BASE_REF");
  if (!ref) {
    throw new Error("GITHUB_BASE_REF is not defined");
  }

  await gitFetch(head);
  await gitFetch(ref);

  const p = new Deno.Command("git", {
    args: ["diff", `${head}..${ref}^`],
    stdout: "piped",
  });

  console.log(colors.dim(`\n$ git diff ${head}..${ref}`));

  const { code, stdout, stderr } = await p.output(); // "p.output()" returns a promise that resolves with the raw output

  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    if (err.includes("fatal: ambiguous argument")) {
      console.error(`rules can't find previous code to compare against. Try checking that your checkout step has 'fetch-depth' of 2 or higher. For example:

- uses: actions/checkout@v2
  with:
    fetch-depth: 2

    `);
    }

    throw new Error(err);
  }

  const text = new TextDecoder().decode(stdout); // Convert the raw output into a string

  return text;
}

export async function gitFetch(ref: string) {
  const p = new Deno.Command("git", {
    args: ["fetch", `origin`, `${ref}:${ref}`],
    stdout: "piped",
  });

  const { code } = await p.output();
  if (code !== 0) {
    throw new Error("git fetch failed");
  }
}

export async function getDiffInGithubAction() {
  const head = Deno.env.get("GITHUB_SHA");
  if (!head) {
    throw new Error("GITHUB_SHA is not defined");
  }
  const ref = Deno.env.get("GITHUB_REF");
  if (!ref) {
    throw new Error("GITHUB_REF is not defined");
  }

  await gitFetch(head);
  await gitFetch(ref);

  const p = new Deno.Command("git", {
    args: ["diff", `${head}..${ref}^`],
    stdout: "piped",
  });

  console.log(colors.dim(`\n$ git diff ${head}..${ref}`));
  const { code, stdout, stderr } = await p.output(); // "p.output()" returns a promise that resolves with the raw output

  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    if (err.includes("fatal: ambiguous argument")) {
      console.error(`rules can't find previous code to compare against. Try checking that your checkout step has 'fetch-depth' of 2 or higher. For example:

- uses: actions/checkout@v2
  with:
    fetch-depth: 2

    `);
    }

    throw new Error(err);
  }

  const text = new TextDecoder().decode(stdout); // Convert the raw output into a string

  return text;
}

export async function getSpecificDiff(diff: string) {
  const p = new Deno.Command("git", {
    args: ["diff", diff],
    stdout: "piped",
  });

  const { code, stdout, stderr } = await p.output(); // "p.output()" returns a promise that resolves with the raw output

  console.log(colors.dim(`\n$ git diff ${diff}`));
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }

  const text = new TextDecoder().decode(stdout); // Convert the raw output into a string

  return text;
}

export async function getDiff(diff?: string) {
  if (diff) {
    return getSpecificDiff(diff);
  }

  // If we're in a github action inside a PR, use that diff
  if (Deno.env.get("GITHUB_HEAD_REF")) {
    return getDiffInGithubActionPullRequest();
  }

  // If we're in a github action, use the github action diff
  if (Deno.env.get("GITHUB_BASE_REF")) {
    return getDiffInGithubAction();
  }

  const p = new Deno.Command("git", {
    args: ["diff", "HEAD^"],
    stdout: "piped",
  });

  const { code, stdout, stderr } = await p.output(); // "p.output()" returns a promise that resolves with the raw output

  console.log(colors.dim(`\n$ git diff HEAD^`));
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }

  const text = new TextDecoder().decode(stdout); // Convert the raw output into a string

  return text;
}

export async function* getChangesAsFiles(diff?: string) {
  const text = await getDiff(diff);
  const files = parseDiffToFiles(text);

  for (const file of files) {
    // Read the file
    const p = await Deno.readFile(file.file);
    const text = new TextDecoder().decode(p);

    yield {
      file: file.file,
      snippet: text,
    };
  }
}

export async function* getChangesAsHunks() {
  const text = await getDiff();
  const hunks = parseDiffToHunks(text);

  for (const hunk of hunks) {
    // Read the file
    const p = await Deno.readFile(hunk.file);
    const text = new TextDecoder().decode(p);

    // Split the file into lines
    const lines = text.split("\n");

    // get the lines that were added
    const paddingBefore = 20;
    const paddingAfter = 20;
    const start = Math.max(0, hunk.z - paddingBefore);
    const end = Math.min(lines.length, hunk.z + hunk.w + paddingAfter);
    const addedLines = lines.slice(start, end).join("\n");

    yield {
      file: hunk.file,
      snippet: addedLines,
    };
  }
}
