import { describe, expect, expectTypeOf, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type BundleConfig,
  type BundleConfigInput,
  type Config,
  type ConfigInput,
  type UploadConfig,
  ConfigError,
  defineConfig,
  expandPath,
  parseConfig,
} from "../../src/config.ts";

describe("expandPath", () => {
  test.each([
    ["~/foo/bar", join(homedir(), "foo/bar")],
    ["~/", join(homedir(), "")],
    ["~/.srcpack", join(homedir(), ".srcpack")],
  ])("should expand %p to home directory path", (input, expected) => {
    expect(expandPath(input)).toBe(expected);
  });

  test.each([
    ["/usr/local/bin", "/usr/local/bin"],
    ["/tmp", "/tmp"],
    ["./dist", "./dist"],
    ["relative/path", "relative/path"],
    [".srcpack", ".srcpack"],
  ])("should leave %p unchanged", (input, expected) => {
    expect(expandPath(input)).toBe(expected);
  });
});

describe("parseConfig", () => {
  describe("bundle patterns", () => {
    test("should accept string pattern", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
      });

      expect(config.bundles.web).toBe("src/**/*");
    });

    test("should accept array of patterns", () => {
      const config = parseConfig({
        bundles: { web: ["src/**/*", "!src/specs"] },
      });

      expect(config.bundles.web).toEqual(["src/**/*", "!src/specs"]);
    });

    test("should accept object with include and outfile", () => {
      const config = parseConfig({
        bundles: {
          web: { include: "src/**/*", outfile: "web.zip" },
        },
      });

      expect(config.bundles.web).toMatchObject({
        include: "src/**/*",
        outfile: "web.zip",
      });
    });

    test("should accept object with index option", () => {
      const config = parseConfig({
        bundles: {
          web: { include: "src/**/*", index: false },
        },
      });

      expect(config.bundles.web).toMatchObject({
        include: "src/**/*",
        index: false,
      });
    });

    test("should default index to true for object config", () => {
      const config = parseConfig({
        bundles: {
          web: { include: "src/**/*" },
        },
      });

      expect(
        (config.bundles.web as { include: string; index: boolean }).index,
      ).toBe(true);
    });

    test("should accept multiple bundles with mixed formats", () => {
      const config = parseConfig({
        bundles: {
          web: "src/web/**/*",
          api: ["src/api/**/*", "!src/api/tests"],
          shared: { include: "src/shared/**/*" },
        },
      });

      expect(Object.keys(config.bundles)).toHaveLength(3);
      expect(config.bundles).toHaveProperty("web");
      expect(config.bundles).toHaveProperty("api");
      expect(config.bundles).toHaveProperty("shared");
    });
  });

  describe("default values", () => {
    test("should default root to process.cwd()", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
      });

      expect(config.root).toBe(process.cwd());
    });

    test("should resolve relative root to absolute path", () => {
      const config = parseConfig({
        root: "./subdir",
        bundles: { web: "src/**/*" },
      });

      expect(config.root).toBe(join(process.cwd(), "subdir"));
    });

    test("should resolve tilde root to home directory", () => {
      const config = parseConfig({
        root: "~/projects",
        bundles: { web: "src/**/*" },
      });

      expect(config.root).toBe(join(homedir(), "projects"));
    });

    test("should keep absolute root path unchanged", () => {
      const config = parseConfig({
        root: "/absolute/path",
        bundles: { web: "src/**/*" },
      });

      expect(config.root).toBe("/absolute/path");
    });

    test("should default outDir to .srcpack", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
      });

      expect(config.outDir).toBe(".srcpack");
    });

    test("should leave upload undefined when not provided", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
      });

      expect(config.upload).toBeUndefined();
    });

    test("should leave emptyOutDir undefined when not provided", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
      });

      expect(config.emptyOutDir).toBeUndefined();
    });

    test("should accept emptyOutDir true", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
        emptyOutDir: true,
      });

      expect(config.emptyOutDir).toBe(true);
    });

    test("should accept emptyOutDir false", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
        emptyOutDir: false,
      });

      expect(config.emptyOutDir).toBe(false);
    });

    test("should accept single upload config", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
        upload: {
          provider: "gdrive",
          folderId: "abc123",
          clientId: "123.apps.googleusercontent.com",
          clientSecret: "GOCSPX-secret",
        },
      });

      expect(config.upload).toMatchObject({
        provider: "gdrive",
        folderId: "abc123",
        clientId: "123.apps.googleusercontent.com",
        clientSecret: "GOCSPX-secret",
      });
    });

    test("should accept array of upload configs", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
        upload: [
          {
            provider: "gdrive",
            folderId: "folder1",
            clientId: "id1",
            clientSecret: "secret1",
          },
          {
            provider: "gdrive",
            folderId: "folder2",
            clientId: "id2",
            clientSecret: "secret2",
          },
        ],
      });

      expect(Array.isArray(config.upload)).toBe(true);
      expect(config.upload).toHaveLength(2);
    });

    test("should accept upload.exclude as array of bundle names", () => {
      const config = parseConfig({
        bundles: {
          web: "src/**/*",
          local: "local/**/*",
          debug: "debug/**/*",
        },
        upload: {
          provider: "gdrive",
          clientId: "id",
          clientSecret: "secret",
          exclude: ["local", "debug"],
        },
      });

      expect((config.upload as UploadConfig).exclude).toEqual([
        "local",
        "debug",
      ]);
    });

    test("should reject an upload.exclude name that is not a bundle", () => {
      // A name that matches nothing uploads the bundle it was meant to hold
      // back — for a bundle of Linear issues, off the machine entirely
      const gdrive = {
        provider: "gdrive",
        clientId: "id",
        clientSecret: "secret",
      };

      expect(() =>
        parseConfig({
          bundles: { planning: { linear: "ENG" } },
          upload: { ...gdrive, exclude: ["planing"] },
        }),
      ).toThrow('upload.exclude: Unknown bundle "planing"');

      expect(() =>
        parseConfig({
          bundles: { planning: { linear: "ENG" } },
          upload: [
            { ...gdrive, exclude: ["planning"] },
            { ...gdrive, exclude: ["planing"] },
          ],
        }),
      ).toThrow('upload.1.exclude: Unknown bundle "planing"');
    });

    test("should leave upload.exclude undefined when not provided", () => {
      const config = parseConfig({
        bundles: { web: "src/**/*" },
        upload: {
          provider: "gdrive",
          clientId: "id",
          clientSecret: "secret",
        },
      });

      expect((config.upload as UploadConfig).exclude).toBeUndefined();
    });
  });

  describe("path expansion", () => {
    test("should expand outDir tilde path to absolute", () => {
      const config = parseConfig({
        outDir: "~/srcpack-output",
        bundles: { web: "src/**/*" },
      });

      expect(config.outDir).toBe(join(homedir(), "srcpack-output"));
    });

    test("should expand outfile tilde path to absolute", () => {
      const config = parseConfig({
        bundles: {
          web: { include: "src/**/*", outfile: "~/downloads/web.zip" },
        },
      });
      const bundle = config.bundles.web as { include: string; outfile: string };

      expect(bundle.outfile).toBe(join(homedir(), "downloads/web.zip"));
    });

    test("should not expand paths in string bundle patterns", () => {
      const config = parseConfig({
        bundles: { web: "~/src/**/*" },
      });

      expect(config.bundles.web).toBe("~/src/**/*");
    });
  });

  describe("validation errors", () => {
    test("should throw ConfigError when bundles key is missing", () => {
      expect(() => parseConfig({})).toThrow(ConfigError);
    });

    test("should throw ConfigError for empty string pattern", () => {
      expect(() => parseConfig({ bundles: { web: "" } })).toThrow(ConfigError);
    });

    test("should throw ConfigError for empty array pattern", () => {
      expect(() => parseConfig({ bundles: { web: [] } })).toThrow(ConfigError);
    });

    test("should throw ConfigError for invalid pattern type", () => {
      expect(() => parseConfig({ bundles: { web: 123 } })).toThrow(ConfigError);
      expect(() => parseConfig({ bundles: { web: null } })).toThrow(
        ConfigError,
      );
    });

    test("should throw ConfigError for empty upload clientId", () => {
      expect(() =>
        parseConfig({
          bundles: { web: "src/**/*" },
          upload: { provider: "gdrive", clientId: "", clientSecret: "secret" },
        }),
      ).toThrow(ConfigError);
    });

    test("should throw ConfigError for empty upload clientSecret", () => {
      expect(() =>
        parseConfig({
          bundles: { web: "src/**/*" },
          upload: { provider: "gdrive", clientId: "id", clientSecret: "" },
        }),
      ).toThrow(ConfigError);
    });

    test("should include field path in error message", () => {
      try {
        parseConfig({ bundles: { web: "" } });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).message).toContain("bundles.web");
      }
    });

    test("should reject a bundle name that is not a filename", () => {
      // The default output is `<outDir>/<name>.txt`, so "../report" writes
      // outside outDir and "-x" names a bundle the CLI can never be given
      for (const name of ["../report", "-x", "a/b", "."]) {
        expect(() => parseConfig({ bundles: { [name]: "src/**/*" } })).toThrow(
          "Bundle name must start with a letter or digit",
        );
      }

      expect(() =>
        parseConfig({ bundles: { "web.v2_final-1": "src/**/*" } }),
      ).not.toThrow();
    });

    test("should reject unknown keys rather than strip them", () => {
      // A stripped key changes behaviour without saying so: `liner` drops the
      // bundle's issues, `emptyOutdir` leaves the automatic default in charge,
      // and `exlude` uploads a bundle that was meant to stay local
      const cases: [unknown, string][] = [
        [
          { bundles: { web: { include: "src/**", liner: "ENG" } } },
          'bundles.web: Unrecognized key: "liner"',
        ],
        [
          { bundles: { web: { include: "src/**", oufile: "web.txt" } } },
          'bundles.web: Unrecognized key: "oufile"',
        ],
        [
          { bundles: {}, emptyOutdir: false },
          'Unrecognized key: "emptyOutdir"',
        ],
        [
          {
            bundles: {},
            upload: {
              provider: "gdrive",
              clientId: "id",
              clientSecret: "secret",
              exlude: ["web"],
            },
          },
          'upload: Unrecognized key: "exlude"',
        ],
      ];

      for (const [config, message] of cases) {
        expect(() => parseConfig(config)).toThrow(message);
      }
    });

    test("should allow empty bundles object", () => {
      const config = parseConfig({ bundles: {} });

      expect(config.bundles).toEqual({});
    });
  });

  describe("linear source", () => {
    test("should accept the team shorthand", () => {
      const config = parseConfig({ bundles: { backlog: { linear: "ENG" } } });

      expect(config.bundles.backlog).toEqual({ linear: "ENG", index: true });
    });

    test("should default includeClosed to false", () => {
      const config = parseConfig({
        bundles: { backlog: { linear: { team: "ENG" } } },
      });

      expect(config.bundles.backlog).toMatchObject({
        linear: { team: "ENG", includeClosed: false },
      });
    });

    test("should accept files and issues together", () => {
      const config = parseConfig({
        bundles: {
          planning: {
            include: ["docs/**"],
            linear: { team: "ENG", project: "Roadmap" },
          },
        },
      });

      expect(config.bundles.planning).toMatchObject({
        include: ["docs/**"],
        linear: { team: "ENG", project: "Roadmap", includeClosed: false },
      });
    });

    test("should trim team and project", () => {
      // A key pasted with a stray space would otherwise fail remotely as
      // "not found", which reads like the wrong key rather than the wrong space
      const config = parseConfig({
        bundles: {
          backlog: { linear: "  ENG  " },
          roadmap: { linear: { team: " ENG ", project: " Roadmap " } },
        },
      });

      expect(config.bundles.backlog).toMatchObject({ linear: "ENG" });
      expect(config.bundles.roadmap).toMatchObject({
        linear: { team: "ENG", project: "Roadmap" },
      });
    });

    test("should require a team", () => {
      expect(() =>
        parseConfig({
          bundles: { backlog: { linear: { project: "Roadmap" } } },
        }),
      ).toThrow(ConfigError);
    });

    test("should reject an unknown key instead of silently widening", () => {
      // Stripping `projet` would quietly fetch the whole team — the exact
      // silent widening the required team and ambiguity checks guard against
      try {
        parseConfig({
          bundles: { backlog: { linear: { team: "ENG", projet: "Roadmap" } } },
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as ConfigError).message).toBe(
          'bundles.backlog.linear: Unrecognized key: "projet"',
        );
      }
    });

    test("should name the offending path for a missing team", () => {
      try {
        parseConfig({ bundles: { backlog: { linear: { project: "R" } } } });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as ConfigError).message).toContain(
          "bundles.backlog.linear.team",
        );
      }
    });

    test("should reject a bundle with no source at all", () => {
      try {
        parseConfig({ bundles: { web: { outfile: "web.txt" } } });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as ConfigError).message).toContain("Bundle needs a source");
      }
    });
  });
});

describe("defineConfig", () => {
  test("should return config unchanged", () => {
    const input: ConfigInput = {
      outDir: "./dist",
      bundles: { web: "src/**/*" },
      upload: {
        provider: "gdrive",
        clientId: "123.apps.googleusercontent.com",
        clientSecret: "GOCSPX-secret",
      },
    };

    expect(defineConfig(input)).toBe(input);
  });
});

describe("type inference", () => {
  test("defineConfig accepts ConfigInput and returns ConfigInput", () => {
    const config = defineConfig({ bundles: { web: "src/**/*" } });

    expectTypeOf(config).toEqualTypeOf<ConfigInput>();
  });

  test("ConfigInput has optional outDir", () => {
    // outDir is optional in input (has default)
    expectTypeOf<{
      bundles: Record<string, BundleConfig>;
    }>().toMatchTypeOf<ConfigInput>();
  });

  test("Config has required root after parsing", () => {
    expectTypeOf<Config>().toHaveProperty("root");
    expectTypeOf<Config["root"]>().toEqualTypeOf<string>();
  });

  test("Config has required outDir after parsing", () => {
    expectTypeOf<Config>().toHaveProperty("outDir");
    expectTypeOf<Config["outDir"]>().toEqualTypeOf<string>();
  });

  test("Config has required bundles property", () => {
    expectTypeOf<Config>().toHaveProperty("bundles");
    expectTypeOf<Config["bundles"]>().toEqualTypeOf<
      Record<string, BundleConfig>
    >();
  });

  test("Config has optional upload property", () => {
    expectTypeOf<Config>().toHaveProperty("upload");
    expectTypeOf<Config["upload"]>().toEqualTypeOf<
      UploadConfig | UploadConfig[] | undefined
    >();
  });

  test("Config has optional emptyOutDir property", () => {
    expectTypeOf<Config>().toHaveProperty("emptyOutDir");
    expectTypeOf<Config["emptyOutDir"]>().toEqualTypeOf<boolean | undefined>();
  });

  test("UploadConfig has optional exclude property", () => {
    expectTypeOf<UploadConfig>().toHaveProperty("exclude");
    expectTypeOf<UploadConfig["exclude"]>().toEqualTypeOf<
      string[] | undefined
    >();
  });

  test("BundleConfig accepts string pattern", () => {
    expectTypeOf<"src/**/*">().toMatchTypeOf<BundleConfig>();
  });

  test("BundleConfig accepts array of patterns", () => {
    expectTypeOf<["src/**/*", "!node_modules"]>().toMatchTypeOf<BundleConfig>();
  });

  test("BundleConfigInput accepts object with include", () => {
    expectTypeOf<{ include: string }>().toMatchTypeOf<BundleConfigInput>();
    expectTypeOf<{
      include: string[];
      outfile: string;
    }>().toMatchTypeOf<BundleConfigInput>();
  });

  test("BundleConfigInput accepts object with index option", () => {
    expectTypeOf<{
      include: string;
      index: boolean;
    }>().toMatchTypeOf<BundleConfigInput>();
  });

  test("parseConfig returns Config type", () => {
    expectTypeOf(parseConfig).returns.toEqualTypeOf<Config>();
  });

  test("expandPath preserves string type", () => {
    expectTypeOf(expandPath).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(expandPath).returns.toEqualTypeOf<string>();
  });
});
