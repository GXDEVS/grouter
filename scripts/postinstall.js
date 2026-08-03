(function() { try {
  var isDocker = process.env.GROUTER_IN_DOCKER === "1";
  var cyan = "\x1b[36m";
  var gray = "\x1b[90m";
  var green = "\x1b[32m";
  var white = "\x1b[37m";
  var bold = "\x1b[1m";
  var reset = "\x1b[0m";

  console.log("");
  console.log(bold + cyan + "  grouter-auth" + reset + gray + " installed successfully" + reset);
  console.log(gray + "  " + "─".repeat(45) + reset);
  console.log("");

  if (isDocker) {
    console.log(green + "  ●" + reset + " " + bold + "Running in Docker" + reset + " — auto-start handled by container");
    console.log(gray + "    Dashboard: " + reset + white + "http://localhost:3099/dashboard" + reset);
    console.log("");
    return;
  }

  console.log(bold + "  Quick start:" + reset);
  console.log("");
  console.log("    " + cyan + "grouter serve on" + reset + gray + "      Start proxy in background" + reset);
  console.log("    " + cyan + "grouter add" + reset + gray + "           Add a provider connection" + reset);
  console.log("    " + cyan + "grouter setup" + reset + gray + "         Interactive wizard" + reset);
  console.log("");
  console.log(gray + "  Dashboard: " + reset + bold + white + "http://localhost:3099/dashboard" + reset);
  console.log(gray + "  Configure providers, monitor usage, and manage settings" + reset);
  console.log(gray + "  directly from your browser — no terminal needed." + reset);
  console.log("");
  console.log(gray + "  " + "─".repeat(45) + reset);
  console.log(gray + "  Endpoint: " + reset + white + "http://localhost:3099/v1/chat/completions" + reset);
  console.log(gray + "  Docs:     " + reset + white + "https://github.com/GXDEVS/grouter" + reset);
  console.log("");
} catch (e) {} })();
