# Third-party notices: search engine archive

The search serving image, and the local-only search provisioning image, carry one pinned engine
archive: Photon 1.3.0 (`photon-1.3.0.jar`, 98,219,380 bytes, SHA-256
`a89707c0045e4807b2a1180e132e68e108d998709f48b6c94b98a6e281f571a5`), published under the Apache
License 2.0 (text in `LICENSE` beside this file). The archive bundles the third-party components
listed below.

## How this file was assembled

A single archive keeps only one file per path, so the `META-INF/NOTICE` it carries is whichever
dependency's notice was written last. This file does not rely on it. Instead:

1. The candidate set is every Maven artifact whose metadata the archive embeds, plus the runtime
   dependency graph of the dependencies Photon 1.3.0 declares in its build file (tag `1.3.0`),
   resolved from their published POMs with the exclusions that build file applies.
2. Each candidate's official artifact was downloaded from Maven Central, and it is listed here only
   if at least half of its classes are present, by exact path, in the pinned archive. Where the
   archive embeds a version, that version is the one checked.
3. Each listed component's own `META-INF` licence and notice files were taken from that official
   artifact. Every distinct notice text is reproduced verbatim below, with the components it
   belongs to, followed by every distinct non-Apache licence text.

Licences are as declared in each component's POM (or its parent POM). Where a component is offered
under a choice of licences, the choice for any redistribution is the owner's decision; see
`docs/supply-chain.md`.

`json-simple:1.1.1` is Apache-2.0: both its published POM and its tagged source
(`tag_release_1_1_1`) declare that licence. The Apache-2.0 text is in `LICENSE` beside this file.

## Bundled components (142)

| Component                                                            | Version      | Declared licence(s)                                                                                |
| -------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `args4j:args4j`                                                      | 2.33         | MIT License                                                                                        |
| `com.fasterxml.jackson.core:jackson-annotations`                     | 2.22         | The Apache Software License, Version 2.0                                                           |
| `com.fasterxml.jackson.core:jackson-core`                            | 2.22.1       | The Apache Software License, Version 2.0                                                           |
| `com.fasterxml.jackson.core:jackson-databind`                        | 2.22.1       | The Apache Software License, Version 2.0                                                           |
| `com.fasterxml.jackson.dataformat:jackson-dataformat-cbor`           | 2.22.1       | The Apache Software License, Version 2.0                                                           |
| `com.fasterxml.jackson.dataformat:jackson-dataformat-smile`          | 2.22.1       | The Apache Software License, Version 2.0                                                           |
| `com.fasterxml.jackson.dataformat:jackson-dataformat-yaml`           | 2.22.1       | The Apache Software License, Version 2.0                                                           |
| `com.github.luben:zstd-jni`                                          | 1.5.6-1      | BSD 2-Clause License                                                                               |
| `com.google.code.findbugs:jsr305`                                    | 3.0.2        | The Apache Software License, Version 2.0                                                           |
| `com.google.protobuf:protobuf-java`                                  | 3.25.8       | BSD-3-Clause                                                                                       |
| `com.googlecode.json-simple:json-simple`                             | 1.1.1        | Apache License, Version 2.0                                                                        |
| `com.jcraft:jzlib`                                                   | 1.1.3        | BSD                                                                                                |
| `com.tdunning:t-digest`                                              | 3.3          | The Apache Software License, Version 2.0                                                           |
| `commons-io:commons-io`                                              | 2.22.0       | Apache-2.0                                                                                         |
| `commons-logging:commons-logging`                                    | 1.3.6        | Apache-2.0                                                                                         |
| `io.javalin:javalin`                                                 | 7.2.2        | The Apache Software License, Version 2.0                                                           |
| `io.javalin:javalin-micrometer`                                      | 7.2.2        | The Apache Software License, Version 2.0                                                           |
| `io.micrometer:micrometer-commons`                                   | 1.17.0       | The Apache Software License, Version 2.0                                                           |
| `io.micrometer:micrometer-core`                                      | 1.17.0       | The Apache Software License, Version 2.0                                                           |
| `io.micrometer:micrometer-observation`                               | 1.17.0       | The Apache Software License, Version 2.0                                                           |
| `io.micrometer:micrometer-registry-prometheus`                       | 1.17.0       | The Apache Software License, Version 2.0                                                           |
| `io.netty:netty-buffer`                                              | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-base`                                          | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-classes-quic`                                  | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-compression`                                   | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-http`                                          | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-http2`                                         | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-codec-http3`                                         | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-common`                                              | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-handler`                                             | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-resolver`                                            | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-transport`                                           | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.netty:netty-transport-native-unix-common`                        | 4.2.15.Final | Apache License, Version 2.0                                                                        |
| `io.projectreactor:reactor-core`                                     | 3.8.6        | Apache License, Version 2.0                                                                        |
| `io.prometheus:prometheus-metrics-config`                            | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `io.prometheus:prometheus-metrics-core`                              | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `io.prometheus:prometheus-metrics-exposition-formats`                | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `io.prometheus:prometheus-metrics-exposition-textformats`            | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `io.prometheus:prometheus-metrics-model`                             | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `io.prometheus:prometheus-metrics-tracer-common`                     | 1.7.0        | The Apache Software License, Version 2.0                                                           |
| `jakarta.annotation:jakarta.annotation-api`                          | 2.1.1        | EPL 2.0; GPL2 w/ CPE                                                                               |
| `jakarta.enterprise:jakarta.enterprise.cdi-api`                      | 4.0.1        | Apache License 2.0                                                                                 |
| `jakarta.enterprise:jakarta.enterprise.lang-model`                   | 4.0.1        | Apache License 2.0                                                                                 |
| `jakarta.inject:jakarta.inject-api`                                  | 2.0.1        | The Apache Software License, Version 2.0                                                           |
| `jakarta.interceptor:jakarta.interceptor-api`                        | 2.1.0        | EPL 2.0; GPL2 w/ CPE                                                                               |
| `jakarta.json:jakarta.json-api`                                      | 2.1.3        | Eclipse Public License 2.0; GNU General Public License, version 2 with the GNU Classpath Exception |
| `jakarta.json.bind:jakarta.json.bind-api`                            | 2.0.0        | Eclipse Public License 2.0; GNU General Public License, version 2 with the GNU Classpath Exception |
| `jakarta.servlet:jakarta.servlet-api`                                | 6.0.0        | EPL 2.0; GPL2 w/ CPE                                                                               |
| `jakarta.transaction:jakarta.transaction-api`                        | 2.0.1        | EPL 2.0; GPL2 w/ CPE                                                                               |
| `joda-time:joda-time`                                                | 2.12.7       | Apache License, Version 2.0                                                                        |
| `net.java.dev.jna:jna`                                               | 5.16.0       | LGPL-2.1-or-later; Apache-2.0                                                                      |
| `net.sf.jopt-simple:jopt-simple`                                     | 5.0.4        | The MIT License                                                                                    |
| `org.apache.commons:commons-dbcp2`                                   | 2.14.0       | Apache-2.0                                                                                         |
| `org.apache.commons:commons-pool2`                                   | 2.13.0       | Apache-2.0                                                                                         |
| `org.apache.httpcomponents.client5:httpclient5`                      | 5.6.3        | Apache License, Version 2.0                                                                        |
| `org.apache.httpcomponents.core5:httpcore5`                          | 5.4.3        | Apache License, Version 2.0                                                                        |
| `org.apache.httpcomponents.core5:httpcore5-h2`                       | 5.4.3        | Apache License, Version 2.0                                                                        |
| `org.apache.logging.log4j:log4j-api`                                 | 2.26.1       | Apache-2.0                                                                                         |
| `org.apache.logging.log4j:log4j-core`                                | 2.26.1       | Apache-2.0                                                                                         |
| `org.apache.logging.log4j:log4j-jul`                                 | 2.25.4       | Apache-2.0                                                                                         |
| `org.apache.logging.log4j:log4j-slf4j2-impl`                         | 2.26.1       | Apache-2.0                                                                                         |
| `org.apache.lucene:lucene-analysis-common`                           | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-backward-codecs`                           | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-core`                                      | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-highlighter`                               | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-join`                                      | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-memory`                                    | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-misc`                                      | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-queries`                                   | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-queryparser`                               | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-sandbox`                                   | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-spatial-extras`                            | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-spatial3d`                                 | 10.5.0       | Apache 2                                                                                           |
| `org.apache.lucene:lucene-suggest`                                   | 10.5.0       | Apache 2                                                                                           |
| `org.checkerframework:checker-qual`                                  | 3.55.1       | The MIT License                                                                                    |
| `org.codelibs:curl4j`                                                | 1.2.8        | The Apache Software License, Version 2.0                                                           |
| `org.codelibs.opensearch:opensearch-runner`                          | 3.8.0.0      | The Apache Software License, Version 2.0                                                           |
| `org.eclipse:yasson`                                                 | 2.0.2        | Eclipse Public License v. 2.0; Eclipse Distribution License v. 1.0                                 |
| `org.eclipse.jetty:jetty-annotations`                                | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-http`                                       | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-io`                                         | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-jndi`                                       | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-plus`                                       | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-security`                                   | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-server`                                     | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-session`                                    | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-util`                                       | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty:jetty-xml`                                        | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee:jetty-ee-webapp`                               | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10:jetty-ee10-annotations`                      | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10:jetty-ee10-plus`                             | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10:jetty-ee10-servlet`                          | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10:jetty-ee10-webapp`                           | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-jetty-server` | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-servlet`      | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.websocket:jetty-websocket-core-common`            | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.websocket:jetty-websocket-core-server`            | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.websocket:jetty-websocket-jetty-api`              | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.websocket:jetty-websocket-jetty-common`           | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.jetty.websocket:jetty-websocket-jetty-server`           | 12.1.8       | EPL-2.0; Apache-2.0                                                                                |
| `org.eclipse.parsson:parsson`                                        | 1.1.7        | Eclipse Public License 2.0; GNU General Public License, version 2 with the GNU Classpath Exception |
| `org.glassfish:jakarta.json`                                         | 2.0.0        | Eclipse Public License 2.0; GNU General Public License, version 2 with the GNU Classpath Exception |
| `org.hdrhistogram:HdrHistogram`                                      | 2.2.2        | Public Domain, per Creative Commons CC0; BSD-2-Clause                                              |
| `org.jcommander:jcommander`                                          | 3.0          | Apache License, Version 2.0                                                                        |
| `org.jetbrains:annotations`                                          | 13.0         | The Apache Software License, Version 2.0                                                           |
| `org.jspecify:jspecify`                                              | 1.0.0        | The Apache License, Version 2.0                                                                    |
| `org.locationtech.jts:jts-core`                                      | 1.20.0       | Eclipse Public License, Version 2.0; Eclipse Distribution License - v 1.0                          |
| `org.locationtech.jts.io:jts-io-common`                              | 1.20.0       | Eclipse Public License, Version 2.0; Eclipse Distribution License - v 1.0                          |
| `org.locationtech.spatial4j:spatial4j`                               | 0.7          | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch`                                          | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-agent-policy`                             | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-arrow-spi`                                | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-cli`                                      | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-common`                                   | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-compress`                                 | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-concurrent-queue`                         | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-core`                                     | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-geo`                                      | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-netty4`                                   | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-plugin-classloader`                       | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-secure-sm`                                | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-task-commons`                             | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-telemetry`                                | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch:opensearch-x-content`                                | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch.client:opensearch-java`                              | 3.9.0        | The Apache License, Version 2.0                                                                    |
| `org.opensearch.plugin:analysis-common`                              | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch.plugin:geo`                                          | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.opensearch.plugin:transport-netty4-client`                      | 3.8.0        | The Apache Software License, Version 2.0                                                           |
| `org.postgresql:postgresql`                                          | 42.7.13      | BSD-2-Clause                                                                                       |
| `org.reactivestreams:reactive-streams`                               | 1.0.4        | MIT-0                                                                                              |
| `org.roaringbitmap:RoaringBitmap`                                    | 1.3.0        | Apache 2                                                                                           |
| `org.slf4j:slf4j-api`                                                | 2.0.17       | MIT                                                                                                |
| `org.snakeyaml:snakeyaml-engine`                                     | 3.0.1        | Apache License, Version 2.0                                                                        |
| `org.springframework:spring-beans`                                   | 7.0.8        | Apache License, Version 2.0                                                                        |
| `org.springframework:spring-core`                                    | 7.0.8        | Apache License, Version 2.0                                                                        |
| `org.springframework:spring-jdbc`                                    | 7.0.8        | Apache License, Version 2.0                                                                        |
| `org.springframework:spring-tx`                                      | 7.0.8        | Apache License, Version 2.0                                                                        |
| `org.yaml:snakeyaml`                                                 | 2.6          | Apache License, Version 2.0                                                                        |
| `tools.jackson.core:jackson-core`                                    | 3.2.1        | The Apache Software License, Version 2.0                                                           |
| `tools.jackson.dataformat:jackson-dataformat-cbor`                   | 3.2.1        | The Apache Software License, Version 2.0                                                           |
| `tools.jackson.dataformat:jackson-dataformat-smile`                  | 3.2.1        | The Apache Software License, Version 2.0                                                           |
| `tools.jackson.dataformat:jackson-dataformat-yaml`                   | 3.2.1        | The Apache Software License, Version 2.0                                                           |

## Component notices (31 distinct texts)

### Notice for `com.fasterxml.jackson.core:jackson-annotations:2.22`, `com.fasterxml.jackson.core:jackson-databind:2.22.1`

```text
# Jackson JSON processor

Jackson is a high-performance, Free/Open Source JSON processing library.
It was originally written by Tatu Saloranta (tatu.saloranta@iki.fi), and has
been in development since 2007.
It is currently developed by a community of developers.

## Copyright

Copyright 2007-, Tatu Saloranta (tatu.saloranta@iki.fi)

## Licensing

Jackson 2.x core and extension components are licensed under Apache License 2.0
To find the details that apply to this artifact see the accompanying LICENSE file.

## Credits

A list of contributors may be found from CREDITS(-2.x) file, which is included
in some artifacts (usually source distributions); but is always available
from the source code management (SCM) system project uses.
```

### Notice for `com.fasterxml.jackson.core:jackson-core:2.22.1`

```text
# Jackson JSON processor

Jackson is a high-performance, Free/Open Source JSON processing library.
It was originally written by Tatu Saloranta (tatu.saloranta@iki.fi), and has
been in development since 2007.
It is currently developed by a community of developers.

## Copyright

Copyright 2007-, Tatu Saloranta (tatu.saloranta@iki.fi)

## Licensing

Jackson 2.x core and extension components are licensed under Apache License 2.0
To find the details that apply to this artifact see the accompanying LICENSE file.

## Credits

A list of contributors may be found from CREDITS(-2.x) file, which is included
in some artifacts (usually source distributions); but is always available
from the source code management (SCM) system project uses.

## FastDoubleParser

jackson-core bundles a shaded copy of FastDoubleParser <https://github.com/wrandelshofer/FastDoubleParser>.
That code is available under an MIT license <https://github.com/wrandelshofer/FastDoubleParser/blob/main/LICENSE>
under the following copyright.

Copyright © 2023 Werner Randelshofer, Switzerland. MIT License.

See FastDoubleParser-LICENSE and also FastDoubleParser-ThirdParty-LICENSE for details of other source code
included in FastDoubleParser and the licenses and copyrights that apply to that code.

## Schubfach

jackson-core bundles a copy of the Schubfach number writing code <https://github.com/c4f7fcce9cb06515/Schubfach>.
That code is available under an MIT license <https://github.com/c4f7fcce9cb06515/Schubfach/blob/master/todec/LICENSE>
under the following copyright.

Copyright 2018-2020 Raffaello Giulietti

See Schubfach-LICENSE.
```

### Notice for `com.fasterxml.jackson.dataformat:jackson-dataformat-cbor:2.22.1`, `com.fasterxml.jackson.dataformat:jackson-dataformat-smile:2.22.1`, `com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.22.1`, `tools.jackson.dataformat:jackson-dataformat-cbor:3.2.1`, `tools.jackson.dataformat:jackson-dataformat-smile:3.2.1`, `tools.jackson.dataformat:jackson-dataformat-yaml:3.2.1`

```text
# Jackson JSON processor

Jackson is a high-performance, Free/Open Source JSON processing library.
It was originally written by Tatu Saloranta (tatu.saloranta@iki.fi), and has
been in development since 2007.
It is currently developed by a community of developers.

## Copyright

Copyright 2007-, Tatu Saloranta (tatu.saloranta@iki.fi)

## Licensing

Jackson components are licensed under Apache (Software) License, version 2.0,
as per accompanying LICENSE file.

## Credits

A list of contributors may be found from CREDITS file, which is included
in some artifacts (usually source distributions); but is always available
from the source code management (SCM) system project uses.
```

### Notice for `commons-io:commons-io:2.22.0`

```text
Apache Commons IO
Copyright 2002-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

### Notice for `commons-logging:commons-logging:1.3.6`

```text
Apache Commons Logging
Copyright 2001-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

### Notice for `io.micrometer:micrometer-commons:1.17.0`, `io.micrometer:micrometer-core:1.17.0`, `io.micrometer:micrometer-observation:1.17.0`, `io.micrometer:micrometer-registry-prometheus:1.17.0`

```text
Micrometer

Copyright (c) 2017-Present VMware, Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

-------------------------------------------------------------------------------

This product contains a modified portion of 'io.netty.util.internal.logging',
in the Netty/Common library distributed by The Netty Project:

  * Copyright 2013 The Netty Project
  * License: Apache License v2.0
  * Homepage: https://netty.io

This product contains a modified portion of 'StringUtils.isBlank()',
in the Commons Lang library distributed by The Apache Software Foundation:

  * Copyright 2001-2019 The Apache Software Foundation
  * License: Apache License v2.0
  * Homepage: https://commons.apache.org/proper/commons-lang/

This product contains a modified portion of 'JsonUtf8Writer',
in the Moshi library distributed by Square, Inc:

  * Copyright 2010 Google Inc.
  * License: Apache License v2.0
  * Homepage: https://github.com/square/moshi

This product contains a modified portion of the 'org.springframework.lang'
package in the Spring Framework library, distributed by VMware, Inc:

  * Copyright 2002-2019 the original author or authors.
  * License: Apache License v2.0
  * Homepage: https://spring.io/projects/spring-framework
```

### Notice for `jakarta.annotation:jakarta.annotation-api:2.1.1`

```text
# Notices for Jakarta Annotations

This content is produced and maintained by the Jakarta Annotations project.

 * Project home: https://projects.eclipse.org/projects/ee4j.ca

## Trademarks

Jakarta Annotations is a trademark of the Eclipse Foundation.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-2.0. This Source Code may also be made
available under the following Secondary Licenses when the conditions for such
availability set forth in the Eclipse Public License v. 2.0 are satisfied: GNU
General Public License, version 2 with the GNU Classpath Exception which is
available at https://www.gnu.org/software/classpath/license.html.

SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

## Source Code

The project maintains the following source code repositories:

 * https://github.com/eclipse-ee4j/common-annotations-api

## Third-party Content

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `jakarta.enterprise:jakarta.enterprise.cdi-api:4.0.1`, `jakarta.enterprise:jakarta.enterprise.lang-model:4.0.1`

```text
# Notices for Jakarta Contexts and Dependency Injection

This content is produced and maintained by the Jakarta Contexts and Dependency Injection
project.

* Project home: https://projects.eclipse.org/projects/ee4j.cdi

## Trademarks

Jakarta Contexts and Dependency Injection is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Apache License v. 2.0 which is available at
http://www.apache.org/licenses/LICENSE-2.0

SPDX-License-Identifier: Apache-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/cdi

## Third-party Content

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `jakarta.inject:jakarta.inject-api:2.0.1`

```text
# Notices for Eclipse Jakarta Dependency Injection

This content is produced and maintained by the Eclipse Jakarta Dependency Injection project.

* Project home: https://projects.eclipse.org/projects/cdi.batch

## Trademarks

Jakarta Dependency Injection is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Apache License, Version 2.0 which is available at
https://www.apache.org/licenses/LICENSE-2.0.

SPDX-License-Identifier: Apache-2.0

## Source Code

The project maintains the following source code repositories:

https://github.com/eclipse-ee4j/injection-api
https://github.com/eclipse-ee4j/injection-spec
https://github.com/eclipse-ee4j/injection-tck

## Third-party Content

This project leverages the following third party content.

None

## Cryptography

None
```

### Notice for `jakarta.interceptor:jakarta.interceptor-api:2.1.0`

```text
# Notices for Eclipse Project for Interceptors

This content is produced and maintained by the Eclipse Project for Interceptors
project.

* Project home: https://projects.eclipse.org/projects/ee4j.interceptors

## Trademarks

Eclipse Project for Interceptors is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-2.0. This Source Code may also be made
available under the following Secondary Licenses when the conditions for such
availability set forth in the Eclipse Public License v. 2.0 are satisfied: GNU
General Public License, version 2 with the GNU Classpath Exception which is
available at https://www.gnu.org/software/classpath/license.html.

SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/interceptor-api

## Third-party Content

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `jakarta.json.bind:jakarta.json.bind-api:2.0.0`

```text
# Notices for Jakarta JSON Binding

This content is produced and maintained by the Jakarta JSON Binding project.

* Project home: https://projects.eclipse.org/projects/ee4j.jsonb

## Trademarks

Jakarta JSON Binding is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-2.0. This Source Code may also be made
available under the following Secondary Licenses when the conditions for such
availability set forth in the Eclipse Public License v. 2.0 are satisfied: GNU
General Public License, version 2 with the GNU Classpath Exception which is
available at https://www.gnu.org/software/classpath/license.html.

SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/jsonb-api

## Third-party Content

This project leverages the following third party content.

None

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `jakarta.json:jakarta.json-api:2.1.3`, `org.glassfish:jakarta.json:2.0.0`

```text
[//]: # " Copyright (c) 2018, 2020 Oracle and/or its affiliates. All rights reserved. "
[//]: # "  "
[//]: # " This program and the accompanying materials are made available under the "
[//]: # " terms of the Eclipse Public License v. 2.0, which is available at "
[//]: # " http://www.eclipse.org/legal/epl-2.0. "
[//]: # "  "
[//]: # " This Source Code may also be made available under the following Secondary "
[//]: # " Licenses when the conditions for such availability set forth in the "
[//]: # " Eclipse Public License v. 2.0 are satisfied: GNU General Public License, "
[//]: # " version 2 with the GNU Classpath Exception, which is available at "
[//]: # " https://www.gnu.org/software/classpath/license.html. "
[//]: # "  "
[//]: # " SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0 "

# Notices for Jakarta JSON Processing

This content is produced and maintained by the Jakarta JSON Processing project.

* Project home: https://projects.eclipse.org/projects/ee4j.jsonp

## Trademarks

 Jakarta JSON Processing is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-2.0. This Source Code may also be made
available under the following Secondary Licenses when the conditions for such
availability set forth in the Eclipse Public License v. 2.0 are satisfied: GNU
General Public License v2.0 w/Classpath exception which is available at
https://www.gnu.org/software/classpath/license.html.

SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/jsonp

## Third-party Content

This project leverages the following third party content.

javax.ws.rs-api:2.0.1 (2.0.1)

* License: (CDDL-1.1 OR GPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0) AND
   Apache-2.0
* Project: https://github.com/jax-rs/api
* Source: https://github.com/jax-rs/api

javax.ws.rs:jsr311-api:jar:1.1.1 (1.1.1)

* License: CDDL-1.0 AND Apache-2.0
* Project: https://github.com/jax-rs/api
* Source:
   http://search.maven.org/remotecontent?filepath=javax/ws/rs/jsr311-api/1.1.1/jsr311-api-1.1.1-sources.jar

javax:javaee-web-api:jar:7.0 (7.0)

* License: (CDDL-1.0 OR GPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0) AND
   (EPL-1.0 OR BSD-3-Clause) AND Apache-2.0 AND LicenseRef-Public Domain
* Project: https://javaee.github.io
* Source:
   http://search.maven.org/remotecontent?filepath=javax/javaee-web-api/7.0/javaee-web-api-7.0-sources.jar

JUnit (4.12)

* License: Eclipse Public License

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `jakarta.transaction:jakarta.transaction-api:2.0.1`

```text
# Notices for Jakarta Transactions

This content is produced and maintained by the Jakarta Transactions project.

* Project home: https://projects.eclipse.org/projects/ee4j.jta

## Trademarks

Jakarta Transactions is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-2.0. This Source Code may also be made
available under the following Secondary Licenses when the conditions for such
availability set forth in the Eclipse Public License v. 2.0 are satisfied: GNU
General Public License, version 2 with the GNU Classpath Exception which is
available at https://www.gnu.org/software/classpath/license.html.

SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/jta-api

## Third-party Content

This project leverages the following third party content.

None

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `joda-time:joda-time:2.12.7`

```text
=============================================================================
= NOTICE file corresponding to section 4d of the Apache License Version 2.0 =
=============================================================================
This product includes software developed by
Joda.org (https://www.joda.org/).
```

### Notice for `org.apache.commons:commons-dbcp2:2.14.0`

```text
Apache Commons DBCP
Copyright 2001-2025 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

### Notice for `org.apache.commons:commons-pool2:2.13.0`

```text
Apache Commons Pool
Copyright 2001-2025 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

### Notice for `org.apache.httpcomponents.client5:httpclient5:5.6.3`

```text

Apache HttpClient
Copyright 1999-2021 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.httpcomponents.core5:httpcore5-h2:5.4.3`

```text

Apache HttpComponents Core HTTP/2
Copyright 2005-2021 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.httpcomponents.core5:httpcore5:5.4.3`

```text

Apache HttpComponents Core HTTP/1.1
Copyright 2005-2021 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.logging.log4j:log4j-api:2.26.1`

```text
Apache Log4j API
Copyright 1999-2026 The Apache Software Foundation


This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.logging.log4j:log4j-core:2.26.1`

```text
Apache Log4j Core
Copyright 1999-2012 Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).

ResolverUtil.java
Copyright 2005-2006 Tim Fennell
```

### Notice for `org.apache.logging.log4j:log4j-jul:2.25.4`

```text
Apache Log4j JUL Adapter
Copyright 1999-2026 The Apache Software Foundation


This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.logging.log4j:log4j-slf4j2-impl:2.26.1`

```text
SLF4J 2 Provider for Log4j API
Copyright 1999-2026 The Apache Software Foundation


This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).
```

### Notice for `org.apache.lucene:lucene-analysis-common:10.5.0`, `org.apache.lucene:lucene-backward-codecs:10.5.0`, `org.apache.lucene:lucene-core:10.5.0`, `org.apache.lucene:lucene-highlighter:10.5.0`, `org.apache.lucene:lucene-join:10.5.0`, `org.apache.lucene:lucene-memory:10.5.0`, `org.apache.lucene:lucene-misc:10.5.0`, `org.apache.lucene:lucene-queries:10.5.0`, `org.apache.lucene:lucene-queryparser:10.5.0`, `org.apache.lucene:lucene-sandbox:10.5.0`, `org.apache.lucene:lucene-spatial-extras:10.5.0`, `org.apache.lucene:lucene-spatial3d:10.5.0`, `org.apache.lucene:lucene-suggest:10.5.0`

```text
Apache Lucene
Copyright 2001-2025 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).

Includes software from other Apache Software Foundation projects,
including, but not limited to:
 - Apache Jakarta Regexp
 - Apache Commons
 - Apache Xerces

ICU4J, (under analysis/icu) is licensed under an MIT styles license
and Copyright (c) 1995-2008 International Business Machines Corporation and others

Some data files (under analysis/icu/src/data) are derived from Unicode data such
as the Unicode Character Database. See http://unicode.org/copyright.html for more
details.

Brics Automaton (under core/src/java/org/apache/lucene/util/automaton) is
BSD-licensed, created by Anders Møller. See http://www.brics.dk/automaton/

The levenshtein automata tables (under core/src/java/org/apache/lucene/util/automaton) were
automatically generated with the moman/finenight FSA library, created by
Jean-Philippe Barrette-LaPierre. This library is available under an MIT license,
see http://sites.google.com/site/rrettesite/moman and
http://bitbucket.org/jpbarrette/moman/overview/

The class org.apache.lucene.util.WeakIdentityMap was derived from
the Apache CXF project and is Apache License 2.0.

The class org.apache.lucene.util.compress.LZ4 is a Java rewrite of the LZ4
compression library (https://github.com/lz4/lz4/tree/dev/lib) that is licensed
under the 2-clause BSD license.
(https://opensource.org/licenses/bsd-license.php)

The Google Code Prettify is Apache License 2.0.
See http://code.google.com/p/google-code-prettify/

This product includes code (JaspellTernarySearchTrie) from Java Spelling Checkin
g Package (jaspell): http://jaspell.sourceforge.net/
License: The BSD License (http://www.opensource.org/licenses/bsd-license.php)

The snowball stemmers in
  analysis/common/src/java/net/sf/snowball
were developed by Martin Porter and Richard Boulton.
The snowball stopword lists in
  analysis/common/src/resources/org/apache/lucene/analysis/snowball
were developed by Martin Porter and Richard Boulton.
The full snowball package is available from
  https://snowballstem.org/

The KStem stemmer in
  analysis/common/src/org/apache/lucene/analysis/en
was developed by Bob Krovetz and Sergio Guzman-Lara (CIIR-UMass Amherst)
under the BSD-license.

The Arabic,Persian,Romanian,Bulgarian, Hindi and Bengali analyzers (common) come with a default
stopword list that is BSD-licensed created by Jacques Savoy.  These files reside in:
analysis/common/src/resources/org/apache/lucene/analysis/ar/stopwords.txt,
analysis/common/src/resources/org/apache/lucene/analysis/fa/stopwords.txt,
analysis/common/src/resources/org/apache/lucene/analysis/ro/stopwords.txt,
analysis/common/src/resources/org/apache/lucene/analysis/bg/stopwords.txt,
analysis/common/src/resources/org/apache/lucene/analysis/hi/stopwords.txt,
analysis/common/src/resources/org/apache/lucene/analysis/bn/stopwords.txt
See http://members.unine.ch/jacques.savoy/clef/index.html.

The German,Spanish,Finnish,French,Hungarian,Italian,Portuguese,Russian and Swedish light stemmers
(common) are based on BSD-licensed reference implementations created by Jacques Savoy and
Ljiljana Dolamic. These files reside in:
analysis/common/src/java/org/apache/lucene/analysis/de/GermanLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/de/GermanMinimalStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/es/SpanishLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/fi/FinnishLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/fr/FrenchLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/fr/FrenchMinimalStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/hu/HungarianLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/it/ItalianLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/pt/PortugueseLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/ru/RussianLightStemmer.java
analysis/common/src/java/org/apache/lucene/analysis/sv/SwedishLightStemmer.java

The Stempel analyzer (stempel) includes BSD-licensed software developed
by the Egothor project http://egothor.sf.net/, created by Leo Galambos, Martin Kvapil,
and Edmond Nolan.

The Polish analyzer (stempel) comes with a default
stopword list that is BSD-licensed created by the Carrot2 project. The file resides
in stempel/src/resources/org/apache/lucene/analysis/pl/stopwords.txt.
See https://github.com/carrot2/carrot2.

The SmartChineseAnalyzer source code (smartcn) was
provided by Xiaoping Gao and copyright 2009 by www.imdict.net.

WordBreakTestUnicode_*.java (under modules/analysis/common/src/test/)
is derived from Unicode data such as the Unicode Character Database.
See http://unicode.org/copyright.html for more details.

The Morfologik analyzer (morfologik) includes BSD-licensed software
developed by Dawid Weiss and Marcin Miłkowski
(https://github.com/morfologik/morfologik-stemming) and uses
data from the BSD-licensed dictionary of Polish (SGJP, http://sgjp.pl/morfeusz/).

===========================================================================
Kuromoji Japanese Morphological Analyzer - Apache Lucene Integration
===========================================================================

This software includes a binary and/or source version of data from

  mecab-ipadic-2.7.0-20070801

which can be obtained from

  http://atilika.com/releases/mecab-ipadic/mecab-ipadic-2.7.0-20070801.tar.gz

or

  http://jaist.dl.sourceforge.net/project/mecab/mecab-ipadic/2.7.0-20070801/mecab-ipadic-2.7.0-20070801.tar.gz

===========================================================================
mecab-ipadic-2.7.0-20070801 Notice
===========================================================================

Nara Institute of Science and Technology (NAIST),
the copyright holders, disclaims all warranties with regard to this
software, including all implied warranties of merchantability and
fitness, in no event shall NAIST be liable for
any special, indirect or consequential damages or any damages
whatsoever resulting from loss of use, data or profits, whether in an
action of contract, negligence or other tortuous action, arising out
of or in connection with the use or performance of this software.

A large portion of the dictionary entries
originate from ICOT Free Software.  The following conditions for ICOT
Free Software applies to the current dictionary as well.

Each User may also freely distribute the Program, whether in its
original form or modified, to any third party or parties, PROVIDED
that the provisions of Section 3 ("NO WARRANTY") will ALWAYS appear
on, or be attached to, the Program, which is distributed substantially
in the same form as set out herein and that such intended
distribution, if actually made, will neither violate or otherwise
contravene any of the laws and regulations of the countries having
jurisdiction over the User or the intended distribution itself.

NO WARRANTY

The program was produced on an experimental basis in the course of the
research and development conducted during the project and is provided
to users as so produced on an experimental basis.  Accordingly, the
program is provided without any warranty whatsoever, whether express,
implied, statutory or otherwise.  The term "warranty" used herein
includes, but is not limited to, any warranty of the quality,
performance, merchantability and fitness for a particular purpose of
the program and the nonexistence of any infringement or violation of
any right of any third party.

Each user of the program will agree and understand, and be deemed to
have agreed and understood, that there is no warranty whatsoever for
the program and, accordingly, the entire risk arising from or
otherwise connected with the program is assumed by the user.

Therefore, neither ICOT, the copyright holder, or any other
organization that participated in or was otherwise related to the
development of the program and their respective officials, directors,
officers and other employees shall be held liable for any and all
damages, including, without limitation, general, special, incidental
and consequential damages, arising out of or otherwise in connection
with the use or inability to use the program or any product, material
or result produced or otherwise obtained by using the program,
regardless of whether they have been advised of, or otherwise had
knowledge of, the possibility of such damages at any time during the
project or thereafter.  Each user will be deemed to have agreed to the
foregoing by his or her commencement of use of the program.  The term
"use" as used herein includes, but is not limited to, the use,
modification, copying and distribution of the program and the
production of secondary products from the program.

In the case where the program, whether in its original form or
modified, was distributed or delivered to or received by a user from
any person, organization or entity other than ICOT, unless it makes or
grants independently of ICOT any specific warranty to the user in
writing, such person, organization or entity, will also be exempted
from and not be held liable to the user for any such damages as noted
above as far as the program is concerned.

===========================================================================
Nori Korean Morphological Analyzer - Apache Lucene Integration
===========================================================================

This software includes a binary and/or source version of data from

  mecab-ko-dic-2.1.1-20180720

which can be obtained from

  https://bitbucket.org/eunjeon/mecab-ko-dic/downloads/mecab-ko-dic-2.1.1-20180720.tar.gz
```

### Notice for `org.eclipse.parsson:parsson:1.1.7`

```text
[//]: # " Copyright (c) 2018, 2020 Oracle and/or its affiliates. All rights reserved. "
[//]: # "  "
[//]: # " This program and the accompanying materials are made available under the "
[//]: # " terms of the Eclipse Public License v. 2.0, which is available at "
[//]: # " http://www.eclipse.org/legal/epl-2.0. "
[//]: # "  "
[//]: # " This Source Code may also be made available under the following Secondary "
[//]: # " Licenses when the conditions for such availability set forth in the "
[//]: # " Eclipse Public License v. 2.0 are satisfied: GNU General Public License, "
[//]: # " version 2 with the GNU Classpath Exception, which is available at "
[//]: # " https://www.gnu.org/software/classpath/license.html. "
[//]: # "  "
[//]: # " SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0 "

# Notices for Eclipse Parsson

This content is produced and maintained by the Eclipse Parsson project.

* Project home: https://projects.eclipse.org/projects/ee4j.parsson

## Trademarks

 Eclipse Parsson is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
https://www.eclipse.org/legal/epl-2.0.

SPDX-License-Identifier: EPL-2.0

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse-ee4j/parsson

## Third-party Content

This project leverages the following third party content.

None

## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `org.eclipse:yasson:2.0.2`

```text
# Notices for Eclipse Yasson

This content is produced and maintained by the Eclipse Yasson project.

* Project home: https://projects.eclipse.org/projects/ee4j.yasson

## Trademarks

Eclipse Yasson is a trademark of the Eclipse Foundation.

## Copyright

All content is the property of the respective authors or their employers. For
more information regarding authorship of content, please consult the listed
source code repository logs.

## Declared Project Licenses

This program and the accompanying materials are made available under the terms
of the Eclipse Public License v. 2.0 which is available at
http://www.eclipse.org/legal/epl-v20.html, or the Eclipse Distribution License
v. 1.0 which is available at http://www.eclipse.org/org/documents/edl-v10.php.

SPDX-License-Identifier: EPL-2.0 OR BSD-3-Clause

## Source Code

The project maintains the following source code repositories:

* https://github.com/eclipse/yasson
* https://github.com/eclipse-ee4j/yasson

## Third-party Content

cdi-api 2.0 (JSR 365: Contexts and Dependency Injection for Java (2.0)


## Cryptography

Content may contain encryption software. The country in which you are currently
may have restrictions on the import, possession, and use, and/or re-export to
another country, of encryption software. BEFORE using any encryption software,
please check the country's laws, regulations and policies concerning the import,
possession, or use, and re-export of encryption software, to see if this is
permitted.
```

### Notice for `org.jcommander:jcommander:3.0`

```text
JCommander Copyright Notices
============================

Copyright 2010 Cedric Beust <cedric@beust.com>
```

### Notice for `org.opensearch.client:opensearch-java:3.9.0`

```text
OpenSearch (https://opensearch.org/)
Copyright OpenSearch Contributors

This product includes software developed by
Elasticsearch Java Client
Copyright 2021 Elasticsearch B.V.
```

### Notice for `org.opensearch.plugin:analysis-common:3.8.0`, `org.opensearch.plugin:geo:3.8.0`, `org.opensearch.plugin:transport-netty4-client:3.8.0`, `org.opensearch:opensearch-agent-policy:3.8.0`, `org.opensearch:opensearch-arrow-spi:3.8.0`, `org.opensearch:opensearch-cli:3.8.0`, `org.opensearch:opensearch-common:3.8.0`, `org.opensearch:opensearch-compress:3.8.0`, `org.opensearch:opensearch-concurrent-queue:3.8.0`, `org.opensearch:opensearch-core:3.8.0`, `org.opensearch:opensearch-geo:3.8.0`, `org.opensearch:opensearch-netty4:3.8.0`, `org.opensearch:opensearch-plugin-classloader:3.8.0`, `org.opensearch:opensearch-secure-sm:3.8.0`, `org.opensearch:opensearch-task-commons:3.8.0`, `org.opensearch:opensearch-telemetry:3.8.0`, `org.opensearch:opensearch-x-content:3.8.0`, `org.opensearch:opensearch:3.8.0`

```text
OpenSearch (https://opensearch.org/)
Copyright OpenSearch Contributors

This product includes software developed by
Elasticsearch (http://www.elastic.co).
Copyright 2009-2018 Elasticsearch

This product includes software developed by The Apache Software
Foundation (http://www.apache.org/).

This product includes software developed by
Joda.org (http://www.joda.org/).

This product includes software developed by
Morten Haraldsen (ethlo) (https://github.com/ethlo) under the Apache License, version 2.0.
```

### Notice for `org.springframework:spring-beans:7.0.8`, `org.springframework:spring-core:7.0.8`, `org.springframework:spring-jdbc:7.0.8`, `org.springframework:spring-tx:7.0.8`

```text
Spring Framework 7.0.8
Copyright (c) 2002-2026 Pivotal, Inc.

This product is licensed to you under the Apache License, Version 2.0
(the "License"). You may not use this product except in compliance with
the License.

This product may include a number of subcomponents with separate
copyright notices and license terms. Your use of the source code for
these subcomponents is subject to the terms and conditions of the
subcomponent's license, as noted in the license.txt file.
```

### Notice for `tools.jackson.core:jackson-core:3.2.1`

```text
# Jackson JSON processor

Jackson is a high-performance, Free/Open Source JSON processing library.
It was originally written by Tatu Saloranta (tatu.saloranta@iki.fi), and has
been in development since 2007.
It is currently developed by a community of developers.

## Copyright

Copyright 2007-, Tatu Saloranta (tatu.saloranta@iki.fi)

## Licensing

Jackson 3.x core and extension components are licensed under Apache License 2.0
To find the details that apply to this artifact see the accompanying LICENSE file.

## Credits

A list of contributors may be found from CREDITS file, which is included
in some artifacts (usually source distributions); but is always available
from the source code management (SCM) system project uses.

## FastDoubleParser

jackson-core bundles a shaded copy of FastDoubleParser <https://github.com/wrandelshofer/FastDoubleParser>.
That code is available under an MIT license <https://github.com/wrandelshofer/FastDoubleParser/blob/main/LICENSE>
under the following copyright.

Copyright © 2023 Werner Randelshofer, Switzerland. MIT License.

See FastDoubleParser-LICENSE and also FastDoubleParser-ThirdParty-LICENSE for details of other source code
included in FastDoubleParser and the licenses and copyrights that apply to that code.

## Schubfach

jackson-core bundles a copy of the Schubfach number writing code <https://github.com/c4f7fcce9cb06515/Schubfach>.
That code is available under an MIT license <https://github.com/c4f7fcce9cb06515/Schubfach/blob/master/todec/LICENSE>
under the following copyright.

Copyright 2018-2020 Raffaello Giulietti

See Schubfach-LICENSE.
```

## Licence texts of components not under the Apache License (8 distinct texts)

### Licence for `jakarta.annotation:jakarta.annotation-api:2.1.1`, `jakarta.interceptor:jakarta.interceptor-api:2.1.0`, `jakarta.json.bind:jakarta.json.bind-api:2.0.0`, `jakarta.json:jakarta.json-api:2.1.3`, `jakarta.transaction:jakarta.transaction-api:2.0.1`, `org.eclipse.parsson:parsson:1.1.7`, `org.glassfish:jakarta.json:2.0.0`

```text
# Eclipse Public License - v 2.0

        THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE
        PUBLIC LICENSE ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION
        OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

    1. DEFINITIONS

    "Contribution" means:

      a) in the case of the initial Contributor, the initial content
         Distributed under this Agreement, and

      b) in the case of each subsequent Contributor:
         i) changes to the Program, and
         ii) additions to the Program;
      where such changes and/or additions to the Program originate from
      and are Distributed by that particular Contributor. A Contribution
      "originates" from a Contributor if it was added to the Program by
      such Contributor itself or anyone acting on such Contributor's behalf.
      Contributions do not include changes or additions to the Program that
      are not Modified Works.

    "Contributor" means any person or entity that Distributes the Program.

    "Licensed Patents" mean patent claims licensable by a Contributor which
    are necessarily infringed by the use or sale of its Contribution alone
    or when combined with the Program.

    "Program" means the Contributions Distributed in accordance with this
    Agreement.

    "Recipient" means anyone who receives the Program under this Agreement
    or any Secondary License (as applicable), including Contributors.

    "Derivative Works" shall mean any work, whether in Source Code or other
    form, that is based on (or derived from) the Program and for which the
    editorial revisions, annotations, elaborations, or other modifications
    represent, as a whole, an original work of authorship.

    "Modified Works" shall mean any work in Source Code or other form that
    results from an addition to, deletion from, or modification of the
    contents of the Program, including, for purposes of clarity any new file
    in Source Code form that contains any contents of the Program. Modified
    Works shall not include works that contain only declarations,
    interfaces, types, classes, structures, or files of the Program solely
    in each case in order to link to, bind by name, or subclass the Program
    or Modified Works thereof.

    "Distribute" means the acts of a) distributing or b) making available
    in any manner that enables the transfer of a copy.

    "Source Code" means the form of a Program preferred for making
    modifications, including but not limited to software source code,
    documentation source, and configuration files.

    "Secondary License" means either the GNU General Public License,
    Version 2.0, or any later versions of that license, including any
    exceptions or additional permissions as identified by the initial
    Contributor.

    2. GRANT OF RIGHTS

      a) Subject to the terms of this Agreement, each Contributor hereby
      grants Recipient a non-exclusive, worldwide, royalty-free copyright
      license to reproduce, prepare Derivative Works of, publicly display,
      publicly perform, Distribute and sublicense the Contribution of such
      Contributor, if any, and such Derivative Works.

      b) Subject to the terms of this Agreement, each Contributor hereby
      grants Recipient a non-exclusive, worldwide, royalty-free patent
      license under Licensed Patents to make, use, sell, offer to sell,
      import and otherwise transfer the Contribution of such Contributor,
      if any, in Source Code or other form. This patent license shall
      apply to the combination of the Contribution and the Program if, at
      the time the Contribution is added by the Contributor, such addition
      of the Contribution causes such combination to be covered by the
      Licensed Patents. The patent license shall not apply to any other
      combinations which include the Contribution. No hardware per se is
      licensed hereunder.

      c) Recipient understands that although each Contributor grants the
      licenses to its Contributions set forth herein, no assurances are
      provided by any Contributor that the Program does not infringe the
      patent or other intellectual property rights of any other entity.
      Each Contributor disclaims any liability to Recipient for claims
      brought by any other entity based on infringement of intellectual
      property rights or otherwise. As a condition to exercising the
      rights and licenses granted hereunder, each Recipient hereby
      assumes sole responsibility to secure any other intellectual
      property rights needed, if any. For example, if a third party
      patent license is required to allow Recipient to Distribute the
      Program, it is Recipient's responsibility to acquire that license
      before distributing the Program.

      d) Each Contributor represents that to its knowledge it has
      sufficient copyright rights in its Contribution, if any, to grant
      the copyright license set forth in this Agreement.

      e) Notwithstanding the terms of any Secondary License, no
      Contributor makes additional grants to any Recipient (other than
      those set forth in this Agreement) as a result of such Recipient's
      receipt of the Program under the terms of a Secondary License
      (if permitted under the terms of Section 3).

    3. REQUIREMENTS

    3.1 If a Contributor Distributes the Program in any form, then:

      a) the Program must also be made available as Source Code, in
      accordance with section 3.2, and the Contributor must accompany
      the Program with a statement that the Source Code for the Program
      is available under this Agreement, and informs Recipients how to
      obtain it in a reasonable manner on or through a medium customarily
      used for software exchange; and

      b) the Contributor may Distribute the Program under a license
      different than this Agreement, provided that such license:
         i) effectively disclaims on behalf of all other Contributors all
         warranties and conditions, express and implied, including
         warranties or conditions of title and non-infringement, and
         implied warranties or conditions of merchantability and fitness
         for a particular purpose;

         ii) effectively excludes on behalf of all other Contributors all
         liability for damages, including direct, indirect, special,
         incidental and consequential damages, such as lost profits;

         iii) does not attempt to limit or alter the recipients' rights
         in the Source Code under section 3.2; and

         iv) requires any subsequent distribution of the Program by any
         party to be under a license that satisfies the requirements
         of this section 3.

    3.2 When the Program is Distributed as Source Code:

      a) it must be made available under this Agreement, or if the
      Program (i) is combined with other material in a separate file or
      files made available under a Secondary License, and (ii) the initial
      Contributor attached to the Source Code the notice described in
      Exhibit A of this Agreement, then the Program may be made available
      under the terms of such Secondary Licenses, and

      b) a copy of this Agreement must be included with each copy of
      the Program.

    3.3 Contributors may not remove or alter any copyright, patent,
    trademark, attribution notices, disclaimers of warranty, or limitations
    of liability ("notices") contained within the Program from any copy of
    the Program which they Distribute, provided that Contributors may add
    their own appropriate notices.

    4. COMMERCIAL DISTRIBUTION

    Commercial distributors of software may accept certain responsibilities
    with respect to end users, business partners and the like. While this
    license is intended to facilitate the commercial use of the Program,
    the Contributor who includes the Program in a commercial product
    offering should do so in a manner which does not create potential
    liability for other Contributors. Therefore, if a Contributor includes
    the Program in a commercial product offering, such Contributor
    ("Commercial Contributor") hereby agrees to defend and indemnify every
    other Contributor ("Indemnified Contributor") against any losses,
    damages and costs (collectively "Losses") arising from claims, lawsuits
    and other legal actions brought by a third party against the Indemnified
    Contributor to the extent caused by the acts or omissions of such
    Commercial Contributor in connection with its distribution of the Program
    in a commercial product offering. The obligations in this section do not
    apply to any claims or Losses relating to any actual or alleged
    intellectual property infringement. In order to qualify, an Indemnified
    Contributor must: a) promptly notify the Commercial Contributor in
    writing of such claim, and b) allow the Commercial Contributor to control,
    and cooperate with the Commercial Contributor in, the defense and any
    related settlement negotiations. The Indemnified Contributor may
    participate in any such claim at its own expense.

    For example, a Contributor might include the Program in a commercial
    product offering, Product X. That Contributor is then a Commercial
    Contributor. If that Commercial Contributor then makes performance
    claims, or offers warranties related to Product X, those performance
    claims and warranties are such Commercial Contributor's responsibility
    alone. Under this section, the Commercial Contributor would have to
    defend claims against the other Contributors related to those performance
    claims and warranties, and if a court requires any other Contributor to
    pay any damages as a result, the Commercial Contributor must pay
    those damages.

    5. NO WARRANTY

    EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
    PERMITTED BY APPLICABLE LAW, THE PROGRAM IS PROVIDED ON AN "AS IS"
    BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR
    IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF
    TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR
    PURPOSE. Each Recipient is solely responsible for determining the
    appropriateness of using and distributing the Program and assumes all
    risks associated with its exercise of rights under this Agreement,
    including but not limited to the risks and costs of program errors,
    compliance with applicable laws, damage to or loss of data, programs
    or equipment, and unavailability or interruption of operations.

    6. DISCLAIMER OF LIABILITY

    EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT
    PERMITTED BY APPLICABLE LAW, NEITHER RECIPIENT NOR ANY CONTRIBUTORS
    SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
    EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST
    PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
    CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
    ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM OR THE
    EXERCISE OF ANY RIGHTS GRANTED HEREUNDER, EVEN IF ADVISED OF THE
    POSSIBILITY OF SUCH DAMAGES.

    7. GENERAL

    If any provision of this Agreement is invalid or unenforceable under
    applicable law, it shall not affect the validity or enforceability of
    the remainder of the terms of this Agreement, and without further
    action by the parties hereto, such provision shall be reformed to the
    minimum extent necessary to make such provision valid and enforceable.

    If Recipient institutes patent litigation against any entity
    (including a cross-claim or counterclaim in a lawsuit) alleging that the
    Program itself (excluding combinations of the Program with other software
    or hardware) infringes such Recipient's patent(s), then such Recipient's
    rights granted under Section 2(b) shall terminate as of the date such
    litigation is filed.

    All Recipient's rights under this Agreement shall terminate if it
    fails to comply with any of the material terms or conditions of this
    Agreement and does not cure such failure in a reasonable period of
    time after becoming aware of such noncompliance. If all Recipient's
    rights under this Agreement terminate, Recipient agrees to cease use
    and distribution of the Program as soon as reasonably practicable.
    However, Recipient's obligations under this Agreement and any licenses
    granted by Recipient relating to the Program shall continue and survive.

    Everyone is permitted to copy and distribute copies of this Agreement,
    but in order to avoid inconsistency the Agreement is copyrighted and
    may only be modified in the following manner. The Agreement Steward
    reserves the right to publish new versions (including revisions) of
    this Agreement from time to time. No one other than the Agreement
    Steward has the right to modify this Agreement. The Eclipse Foundation
    is the initial Agreement Steward. The Eclipse Foundation may assign the
    responsibility to serve as the Agreement Steward to a suitable separate
    entity. Each new version of the Agreement will be given a distinguishing
    version number. The Program (including Contributions) may always be
    Distributed subject to the version of the Agreement under which it was
    received. In addition, after a new version of the Agreement is published,
    Contributor may elect to Distribute the Program (including its
    Contributions) under the new version.

    Except as expressly stated in Sections 2(a) and 2(b) above, Recipient
    receives no rights or licenses to the intellectual property of any
    Contributor under this Agreement, whether expressly, by implication,
    estoppel or otherwise. All rights in the Program not expressly granted
    under this Agreement are reserved. Nothing in this Agreement is intended
    to be enforceable by any entity that is not a Contributor or Recipient.
    No third-party beneficiary rights are created under this Agreement.

    Exhibit A - Form of Secondary Licenses Notice

    "This Source Code may also be made available under the following
    Secondary Licenses when the conditions for such availability set forth
    in the Eclipse Public License, v. 2.0 are satisfied: {name license(s),
    version(s), and exceptions or additional permissions here}."

      Simply including a copy of this Agreement, including this Exhibit A
      is not sufficient to license the Source Code under Secondary Licenses.

      If it is not possible or desirable to put the notice in a particular
      file, then You may include the notice in a location (such as a LICENSE
      file in a relevant directory) where a recipient would be likely to
      look for such a notice.

      You may add additional accurate notices of copyright ownership.

---

##    The GNU General Public License (GPL) Version 2, June 1991

    Copyright (C) 1989, 1991 Free Software Foundation, Inc.
    51 Franklin Street, Fifth Floor
    Boston, MA 02110-1335
    USA

    Everyone is permitted to copy and distribute verbatim copies
    of this license document, but changing it is not allowed.

    Preamble

    The licenses for most software are designed to take away your freedom to
    share and change it. By contrast, the GNU General Public License is
    intended to guarantee your freedom to share and change free software--to
    make sure the software is free for all its users. This General Public
    License applies to most of the Free Software Foundation's software and
    to any other program whose authors commit to using it. (Some other Free
    Software Foundation software is covered by the GNU Library General
    Public License instead.) You can apply it to your programs, too.

    When we speak of free software, we are referring to freedom, not price.
    Our General Public Licenses are designed to make sure that you have the
    freedom to distribute copies of free software (and charge for this
    service if you wish), that you receive source code or can get it if you
    want it, that you can change the software or use pieces of it in new
    free programs; and that you know you can do these things.

    To protect your rights, we need to make restrictions that forbid anyone
    to deny you these rights or to ask you to surrender the rights. These
    restrictions translate to certain responsibilities for you if you
    distribute copies of the software, or if you modify it.

    For example, if you distribute copies of such a program, whether gratis
    or for a fee, you must give the recipients all the rights that you have.
    You must make sure that they, too, receive or can get the source code.
    And you must show them these terms so they know their rights.

    We protect your rights with two steps: (1) copyright the software, and
    (2) offer you this license which gives you legal permission to copy,
    distribute and/or modify the software.

    Also, for each author's protection and ours, we want to make certain
    that everyone understands that there is no warranty for this free
    software. If the software is modified by someone else and passed on, we
    want its recipients to know that what they have is not the original, so
    that any problems introduced by others will not reflect on the original
    authors' reputations.

    Finally, any free program is threatened constantly by software patents.
    We wish to avoid the danger that redistributors of a free program will
    individually obtain patent licenses, in effect making the program
    proprietary. To prevent this, we have made it clear that any patent must
    be licensed for everyone's free use or not licensed at all.

    The precise terms and conditions for copying, distribution and
    modification follow.

    TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

    0. This License applies to any program or other work which contains a
    notice placed by the copyright holder saying it may be distributed under
    the terms of this General Public License. The "Program", below, refers
    to any such program or work, and a "work based on the Program" means
    either the Program or any derivative work under copyright law: that is
    to say, a work containing the Program or a portion of it, either
    verbatim or with modifications and/or translated into another language.
    (Hereinafter, translation is included without limitation in the term
    "modification".) Each licensee is addressed as "you".

    Activities other than copying, distribution and modification are not
    covered by this License; they are outside its scope. The act of running
    the Program is not restricted, and the output from the Program is
    covered only if its contents constitute a work based on the Program
    (independent of having been made by running the Program). Whether that
    is true depends on what the Program does.

    1. You may copy and distribute verbatim copies of the Program's source
    code as you receive it, in any medium, provided that you conspicuously
    and appropriately publish on each copy an appropriate copyright notice
    and disclaimer of warranty; keep intact all the notices that refer to
    this License and to the absence of any warranty; and give any other
    recipients of the Program a copy of this License along with the Program.

    You may charge a fee for the physical act of transferring a copy, and
    you may at your option offer warranty protection in exchange for a fee.

    2. You may modify your copy or copies of the Program or any portion of
    it, thus forming a work based on the Program, and copy and distribute
    such modifications or work under the terms of Section 1 above, provided
    that you also meet all of these conditions:

        a) You must cause the modified files to carry prominent notices
        stating that you changed the files and the date of any change.

        b) You must cause any work that you distribute or publish, that in
        whole or in part contains or is derived from the Program or any part
        thereof, to be licensed as a whole at no charge to all third parties
        under the terms of this License.

        c) If the modified program normally reads commands interactively
        when run, you must cause it, when started running for such
        interactive use in the most ordinary way, to print or display an
        announcement including an appropriate copyright notice and a notice
        that there is no warranty (or else, saying that you provide a
        warranty) and that users may redistribute the program under these
        conditions, and telling the user how to view a copy of this License.
        (Exception: if the Program itself is interactive but does not
        normally print such an announcement, your work based on the Program
        is not required to print an announcement.)

    These requirements apply to the modified work as a whole. If
    identifiable sections of that work are not derived from the Program, and
    can be reasonably considered independent and separate works in
    themselves, then this License, and its terms, do not apply to those
    sections when you distribute them as separate works. But when you
    distribute the same sections as part of a whole which is a work based on
    the Program, the distribution of the whole must be on the terms of this
    License, whose permissions for other licensees extend to the entire
    whole, and thus to each and every part regardless of who wrote it.

    Thus, it is not the intent of this section to claim rights or contest
    your rights to work written entirely by you; rather, the intent is to
    exercise the right to control the distribution of derivative or
    collective works based on the Program.

    In addition, mere aggregation of another work not based on the Program
    with the Program (or with a work based on the Program) on a volume of a
    storage or distribution medium does not bring the other work under the
    scope of this License.

    3. You may copy and distribute the Program (or a work based on it,
    under Section 2) in object code or executable form under the terms of
    Sections 1 and 2 above provided that you also do one of the following:

        a) Accompany it with the complete corresponding machine-readable
        source code, which must be distributed under the terms of Sections 1
        and 2 above on a medium customarily used for software interchange; or,

        b) Accompany it with a written offer, valid for at least three
        years, to give any third party, for a charge no more than your cost
        of physically performing source distribution, a complete
        machine-readable copy of the corresponding source code, to be
        distributed under the terms of Sections 1 and 2 above on a medium
        customarily used for software interchange; or,

        c) Accompany it with the information you received as to the offer to
        distribute corresponding source code. (This alternative is allowed
        only for noncommercial distribution and only if you received the
        program in object code or executable form with such an offer, in
        accord with Subsection b above.)

    The source code for a work means the preferred form of the work for
    making modifications to it. For an executable work, complete source code
    means all the source code for all modules it contains, plus any
    associated interface definition files, plus the scripts used to control
    compilation and installation of the executable. However, as a special
    exception, the source code distributed need not include anything that is
    normally distributed (in either source or binary form) with the major
    components (compiler, kernel, and so on) of the operating system on
    which the executable runs, unless that component itself accompanies the
    executable.

    If distribution of executable or object code is made by offering access
    to copy from a designated place, then offering equivalent access to copy
    the source code from the same place counts as distribution of the source
    code, even though third parties are not compelled to copy the source
    along with the object code.

    4. You may not copy, modify, sublicense, or distribute the Program
    except as expressly provided under this License. Any attempt otherwise
    to copy, modify, sublicense or distribute the Program is void, and will
    automatically terminate your rights under this License. However, parties
    who have received copies, or rights, from you under this License will
    not have their licenses terminated so long as such parties remain in
    full compliance.

    5. You are not required to accept this License, since you have not
    signed it. However, nothing else grants you permission to modify or
    distribute the Program or its derivative works. These actions are
    prohibited by law if you do not accept this License. Therefore, by
    modifying or distributing the Program (or any work based on the
    Program), you indicate your acceptance of this License to do so, and all
    its terms and conditions for copying, distributing or modifying the
    Program or works based on it.

    6. Each time you redistribute the Program (or any work based on the
    Program), the recipient automatically receives a license from the
    original licensor to copy, distribute or modify the Program subject to
    these terms and conditions. You may not impose any further restrictions
    on the recipients' exercise of the rights granted herein. You are not
    responsible for enforcing compliance by third parties to this License.

    7. If, as a consequence of a court judgment or allegation of patent
    infringement or for any other reason (not limited to patent issues),
    conditions are imposed on you (whether by court order, agreement or
    otherwise) that contradict the conditions of this License, they do not
    excuse you from the conditions of this License. If you cannot distribute
    so as to satisfy simultaneously your obligations under this License and
    any other pertinent obligations, then as a consequence you may not
    distribute the Program at all. For example, if a patent license would
    not permit royalty-free redistribution of the Program by all those who
    receive copies directly or indirectly through you, then the only way you
    could satisfy both it and this License would be to refrain entirely from
    distribution of the Program.

    If any portion of this section is held invalid or unenforceable under
    any particular circumstance, the balance of the section is intended to
    apply and the section as a whole is intended to apply in other
    circumstances.

    It is not the purpose of this section to induce you to infringe any
    patents or other property right claims or to contest validity of any
    such claims; this section has the sole purpose of protecting the
    integrity of the free software distribution system, which is implemented
    by public license practices. Many people have made generous
    contributions to the wide range of software distributed through that
    system in reliance on consistent application of that system; it is up to
    the author/donor to decide if he or she is willing to distribute
    software through any other system and a licensee cannot impose that choice.

    This section is intended to make thoroughly clear what is believed to be
    a consequence of the rest of this License.

    8. If the distribution and/or use of the Program is restricted in
    certain countries either by patents or by copyrighted interfaces, the
    original copyright holder who places the Program under this License may
    add an explicit geographical distribution limitation excluding those
    countries, so that distribution is permitted only in or among countries
    not thus excluded. In such case, this License incorporates the
    limitation as if written in the body of this License.

    9. The Free Software Foundation may publish revised and/or new
    versions of the General Public License from time to time. Such new
    versions will be similar in spirit to the present version, but may
    differ in detail to address new problems or concerns.

    Each version is given a distinguishing version number. If the Program
    specifies a version number of this License which applies to it and "any
    later version", you have the option of following the terms and
    conditions either of that version or of any later version published by
    the Free Software Foundation. If the Program does not specify a version
    number of this License, you may choose any version ever published by the
    Free Software Foundation.

    10. If you wish to incorporate parts of the Program into other free
    programs whose distribution conditions are different, write to the
    author to ask for permission. For software which is copyrighted by the
    Free Software Foundation, write to the Free Software Foundation; we
    sometimes make exceptions for this. Our decision will be guided by the
    two goals of preserving the free status of all derivatives of our free
    software and of promoting the sharing and reuse of software generally.

    NO WARRANTY

    11. BECAUSE THE PROGRAM IS LICENSED FREE OF CHARGE, THERE IS NO
    WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY APPLICABLE LAW.
    EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR
    OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY OF ANY KIND,
    EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
    WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE
    ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM IS WITH
    YOU. SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL
    NECESSARY SERVICING, REPAIR OR CORRECTION.

    12. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN
    WRITING WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY
    AND/OR REDISTRIBUTE THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR
    DAMAGES, INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL
    DAMAGES ARISING OUT OF THE USE OR INABILITY TO USE THE PROGRAM
    (INCLUDING BUT NOT LIMITED TO LOSS OF DATA OR DATA BEING RENDERED
    INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD PARTIES OR A FAILURE OF
    THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS), EVEN IF SUCH HOLDER OR
    OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

    END OF TERMS AND CONDITIONS

    How to Apply These Terms to Your New Programs

    If you develop a new program, and you want it to be of the greatest
    possible use to the public, the best way to achieve this is to make it
    free software which everyone can redistribute and change under these terms.

    To do so, attach the following notices to the program. It is safest to
    attach them to the start of each source file to most effectively convey
    the exclusion of warranty; and each file should have at least the
    "copyright" line and a pointer to where the full notice is found.

        One line to give the program's name and a brief idea of what it does.
        Copyright (C) <year> <name of author>

        This program is free software; you can redistribute it and/or modify
        it under the terms of the GNU General Public License as published by
        the Free Software Foundation; either version 2 of the License, or
        (at your option) any later version.

        This program is distributed in the hope that it will be useful, but
        WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
        General Public License for more details.

        You should have received a copy of the GNU General Public License
        along with this program; if not, write to the Free Software
        Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1335 USA

    Also add information on how to contact you by electronic and paper mail.

    If the program is interactive, make it output a short notice like this
    when it starts in an interactive mode:

        Gnomovision version 69, Copyright (C) year name of author
        Gnomovision comes with ABSOLUTELY NO WARRANTY; for details type
        `show w'. This is free software, and you are welcome to redistribute
        it under certain conditions; type `show c' for details.

    The hypothetical commands `show w' and `show c' should show the
    appropriate parts of the General Public License. Of course, the commands
    you use may be called something other than `show w' and `show c'; they
    could even be mouse-clicks or menu items--whatever suits your program.

    You should also get your employer (if you work as a programmer) or your
    school, if any, to sign a "copyright disclaimer" for the program, if
    necessary. Here is a sample; alter the names:

        Yoyodyne, Inc., hereby disclaims all copyright interest in the
        program `Gnomovision' (which makes passes at compilers) written by
        James Hacker.

        signature of Ty Coon, 1 April 1989
        Ty Coon, President of Vice

    This General Public License does not permit incorporating your program
    into proprietary programs. If your program is a subroutine library, you
    may consider it more useful to permit linking proprietary applications
    with the library. If this is what you want to do, use the GNU Library
    General Public License instead of this License.

---

## CLASSPATH EXCEPTION

    Linking this library statically or dynamically with other modules is
    making a combined work based on this library.  Thus, the terms and
    conditions of the GNU General Public License version 2 cover the whole
    combination.

    As a special exception, the copyright holders of this library give you
    permission to link this library with independent modules to produce an
    executable, regardless of the license terms of these independent
    modules, and to copy and distribute the resulting executable under
    terms of your choice, provided that you also meet, for each linked
    independent module, the terms and conditions of the license of that
    module.  An independent module is a module which is not derived from or
    based on this library.  If you modify this library, you may extend this
    exception to your version of the library, but you are not obligated to
    do so.  If you do not wish to do so, delete this exception statement
    from your version.
```

### Licence for `org.checkerframework:checker-qual:3.55.1`

```text
Checker Framework qualifiers
Copyright 2004-present by the Checker Framework developers

MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Licence for `org.eclipse:yasson:2.0.2`

```text
# Eclipse Public License - v 2.0

    THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE PUBLIC LICENSE (“AGREEMENT”). ANY USE, REPRODUCTION OR DISTRIBUTION OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.
    1. DEFINITIONS

    “Contribution” means:

        a) in the case of the initial Contributor, the initial content Distributed under this Agreement, and
        b) in the case of each subsequent Contributor:
            i) changes to the Program, and
            ii) additions to the Program;
        where such changes and/or additions to the Program originate from and are Distributed by that particular Contributor. A Contribution “originates” from a Contributor if it was added to the Program by such Contributor itself or anyone acting on such Contributor's behalf. Contributions do not include changes or additions to the Program that are not Modified Works.

    “Contributor” means any person or entity that Distributes the Program.

    “Licensed Patents” mean patent claims licensable by a Contributor which are necessarily infringed by the use or sale of its Contribution alone or when combined with the Program.

    “Program” means the Contributions Distributed in accordance with this Agreement.

    “Recipient” means anyone who receives the Program under this Agreement or any Secondary License (as applicable), including Contributors.

    “Derivative Works” shall mean any work, whether in Source Code or other form, that is based on (or derived from) the Program and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship.

    “Modified Works” shall mean any work in Source Code or other form that results from an addition to, deletion from, or modification of the contents of the Program, including, for purposes of clarity any new file in Source Code form that contains any contents of the Program. Modified Works shall not include works that contain only declarations, interfaces, types, classes, structures, or files of the Program solely in each case in order to link to, bind by name, or subclass the Program or Modified Works thereof.

    “Distribute” means the acts of a) distributing or b) making available in any manner that enables the transfer of a copy.

    “Source Code” means the form of a Program preferred for making modifications, including but not limited to software source code, documentation source, and configuration files.

    “Secondary License” means either the GNU General Public License, Version 2.0, or any later versions of that license, including any exceptions or additional permissions as identified by the initial Contributor.
    2. GRANT OF RIGHTS

        a) Subject to the terms of this Agreement, each Contributor hereby grants Recipient a non-exclusive, worldwide, royalty-free copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, Distribute and sublicense the Contribution of such Contributor, if any, and such Derivative Works.
        b) Subject to the terms of this Agreement, each Contributor hereby grants Recipient a non-exclusive, worldwide, royalty-free patent license under Licensed Patents to make, use, sell, offer to sell, import and otherwise transfer the Contribution of such Contributor, if any, in Source Code or other form. This patent license shall apply to the combination of the Contribution and the Program if, at the time the Contribution is added by the Contributor, such addition of the Contribution causes such combination to be covered by the Licensed Patents. The patent license shall not apply to any other combinations which include the Contribution. No hardware per se is licensed hereunder.
        c) Recipient understands that although each Contributor grants the licenses to its Contributions set forth herein, no assurances are provided by any Contributor that the Program does not infringe the patent or other intellectual property rights of any other entity. Each Contributor disclaims any liability to Recipient for claims brought by any other entity based on infringement of intellectual property rights or otherwise. As a condition to exercising the rights and licenses granted hereunder, each Recipient hereby assumes sole responsibility to secure any other intellectual property rights needed, if any. For example, if a third party patent license is required to allow Recipient to Distribute the Program, it is Recipient's responsibility to acquire that license before distributing the Program.
        d) Each Contributor represents that to its knowledge it has sufficient copyright rights in its Contribution, if any, to grant the copyright license set forth in this Agreement.
        e) Notwithstanding the terms of any Secondary License, no Contributor makes additional grants to any Recipient (other than those set forth in this Agreement) as a result of such Recipient's receipt of the Program under the terms of a Secondary License (if permitted under the terms of Section 3).

    3. REQUIREMENTS

    3.1 If a Contributor Distributes the Program in any form, then:

        a) the Program must also be made available as Source Code, in accordance with section 3.2, and the Contributor must accompany the Program with a statement that the Source Code for the Program is available under this Agreement, and informs Recipients how to obtain it in a reasonable manner on or through a medium customarily used for software exchange; and
        b) the Contributor may Distribute the Program under a license different than this Agreement, provided that such license:
            i) effectively disclaims on behalf of all other Contributors all warranties and conditions, express and implied, including warranties or conditions of title and non-infringement, and implied warranties or conditions of merchantability and fitness for a particular purpose;
            ii) effectively excludes on behalf of all other Contributors all liability for damages, including direct, indirect, special, incidental and consequential damages, such as lost profits;
            iii) does not attempt to limit or alter the recipients' rights in the Source Code under section 3.2; and
            iv) requires any subsequent distribution of the Program by any party to be under a license that satisfies the requirements of this section 3.

    3.2 When the Program is Distributed as Source Code:

        a) it must be made available under this Agreement, or if the Program (i) is combined with other material in a separate file or files made available under a Secondary License, and (ii) the initial Contributor attached to the Source Code the notice described in Exhibit A of this Agreement, then the Program may be made available under the terms of such Secondary Licenses, and
        b) a copy of this Agreement must be included with each copy of the Program.

    3.3 Contributors may not remove or alter any copyright, patent, trademark, attribution notices, disclaimers of warranty, or limitations of liability (‘notices’) contained within the Program from any copy of the Program which they Distribute, provided that Contributors may add their own appropriate notices.
    4. COMMERCIAL DISTRIBUTION

    Commercial distributors of software may accept certain responsibilities with respect to end users, business partners and the like. While this license is intended to facilitate the commercial use of the Program, the Contributor who includes the Program in a commercial product offering should do so in a manner which does not create potential liability for other Contributors. Therefore, if a Contributor includes the Program in a commercial product offering, such Contributor (“Commercial Contributor”) hereby agrees to defend and indemnify every other Contributor (“Indemnified Contributor”) against any losses, damages and costs (collectively “Losses”) arising from claims, lawsuits and other legal actions brought by a third party against the Indemnified Contributor to the extent caused by the acts or omissions of such Commercial Contributor in connection with its distribution of the Program in a commercial product offering. The obligations in this section do not apply to any claims or Losses relating to any actual or alleged intellectual property infringement. In order to qualify, an Indemnified Contributor must: a) promptly notify the Commercial Contributor in writing of such claim, and b) allow the Commercial Contributor to control, and cooperate with the Commercial Contributor in, the defense and any related settlement negotiations. The Indemnified Contributor may participate in any such claim at its own expense.

    For example, a Contributor might include the Program in a commercial product offering, Product X. That Contributor is then a Commercial Contributor. If that Commercial Contributor then makes performance claims, or offers warranties related to Product X, those performance claims and warranties are such Commercial Contributor's responsibility alone. Under this section, the Commercial Contributor would have to defend claims against the other Contributors related to those performance claims and warranties, and if a court requires any other Contributor to pay any damages as a result, the Commercial Contributor must pay those damages.
    5. NO WARRANTY

    EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT PERMITTED BY APPLICABLE LAW, THE PROGRAM IS PROVIDED ON AN “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Each Recipient is solely responsible for determining the appropriateness of using and distributing the Program and assumes all risks associated with its exercise of rights under this Agreement, including but not limited to the risks and costs of program errors, compliance with applicable laws, damage to or loss of data, programs or equipment, and unavailability or interruption of operations.
    6. DISCLAIMER OF LIABILITY

    EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT PERMITTED BY APPLICABLE LAW, NEITHER RECIPIENT NOR ANY CONTRIBUTORS SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM OR THE EXERCISE OF ANY RIGHTS GRANTED HEREUNDER, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
    7. GENERAL

    If any provision of this Agreement is invalid or unenforceable under applicable law, it shall not affect the validity or enforceability of the remainder of the terms of this Agreement, and without further action by the parties hereto, such provision shall be reformed to the minimum extent necessary to make such provision valid and enforceable.

    If Recipient institutes patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Program itself (excluding combinations of the Program with other software or hardware) infringes such Recipient's patent(s), then such Recipient's rights granted under Section 2(b) shall terminate as of the date such litigation is filed.

    All Recipient's rights under this Agreement shall terminate if it fails to comply with any of the material terms or conditions of this Agreement and does not cure such failure in a reasonable period of time after becoming aware of such noncompliance. If all Recipient's rights under this Agreement terminate, Recipient agrees to cease use and distribution of the Program as soon as reasonably practicable. However, Recipient's obligations under this Agreement and any licenses granted by Recipient relating to the Program shall continue and survive.

    Everyone is permitted to copy and distribute copies of this Agreement, but in order to avoid inconsistency the Agreement is copyrighted and may only be modified in the following manner. The Agreement Steward reserves the right to publish new versions (including revisions) of this Agreement from time to time. No one other than the Agreement Steward has the right to modify this Agreement. The Eclipse Foundation is the initial Agreement Steward. The Eclipse Foundation may assign the responsibility to serve as the Agreement Steward to a suitable separate entity. Each new version of the Agreement will be given a distinguishing version number. The Program (including Contributions) may always be Distributed subject to the version of the Agreement under which it was received. In addition, after a new version of the Agreement is published, Contributor may elect to Distribute the Program (including its Contributions) under the new version.

    Except as expressly stated in Sections 2(a) and 2(b) above, Recipient receives no rights or licenses to the intellectual property of any Contributor under this Agreement, whether expressly, by implication, estoppel or otherwise. All rights in the Program not expressly granted under this Agreement are reserved. Nothing in this Agreement is intended to be enforceable by any entity that is not a Contributor or Recipient. No third-party beneficiary rights are created under this Agreement.
    Exhibit A – Form of Secondary Licenses Notice

    “This Source Code may also be made available under the following Secondary Licenses when the conditions for such availability set forth in the Eclipse Public License, v. 2.0 are satisfied: {name license(s), version(s), and exceptions or additional permissions here}.”

        Simply including a copy of this Agreement, including this Exhibit A is not sufficient to license the Source Code under Secondary Licenses.

        If it is not possible or desirable to put the notice in a particular file, then You may include the notice in a location (such as a LICENSE file in a relevant directory) where a recipient would be likely to look for such a notice.

        You may add additional accurate notices of copyright ownership.


# Eclipse Distribution License - v 1.0

    Copyright (c) 2007, Eclipse Foundation, Inc. and its licensors.

    All rights reserved.

    Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

    Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
    Neither the name of the Eclipse Foundation, Inc. nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Licence for `org.hdrhistogram:HdrHistogram:2.2.2`

```text
The code in this repository code was Written by Gil Tene, Michael Barker,
and Matt Warren, and released to the public domain, as explained at
http://creativecommons.org/publicdomain/zero/1.0/

For users of this code who wish to consume it under the "BSD" license
rather than under the public domain or CC0 contribution text mentioned
above, the code found under this directory is *also* provided under the
following license (commonly referred to as the BSD 2-Clause License). This
license does not detract from the above stated release of the code into
the public domain, and simply represents an additional license granted by
the Author.

-----------------------------------------------------------------------------
** Beginning of "BSD 2-Clause License" text. **

 Copyright (c) 2012, 2013, 2014, 2015, 2016 Gil Tene
 Copyright (c) 2014 Michael Barker
 Copyright (c) 2014 Matt Warren
 All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 1. Redistributions of source code must retain the above copyright notice,
    this list of conditions and the following disclaimer.

 2. Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 THE POSSIBILITY OF SUCH DAMAGE.
```

### Licence for `org.postgresql:postgresql:42.7.13`

```text
Copyright (c) 1997, PostgreSQL Global Development Group
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

Additional License files can be found in the 'licenses' folder located in the same directory as the LICENSE file (i.e. this file)

- Software produced outside the ASF which is available under other licenses (not Apache-2.0)

BSD-2-Clause
* com.ongres.scram:scram-client:3.2
* com.ongres.scram:scram-common:3.2
* com.ongres.stringprep:saslprep:2.2
* com.ongres.stringprep:stringprep:2.2
```

### Licence for `org.postgresql:postgresql:42.7.13`

```text
Copyright (c) 2017 OnGres, Inc.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Licence for `org.postgresql:postgresql:42.7.13`

```text
Copyright (c) 2019 OnGres, Inc.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation and/or
other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Licence for `org.slf4j:slf4j-api:2.0.17`

```text
Copyright (c) 2004-2022 QOS.ch Sarl (Switzerland)
All rights reserved.

Permission is hereby granted, free  of charge, to any person obtaining
a  copy  of this  software  and  associated  documentation files  (the
"Software"), to  deal in  the Software without  restriction, including
without limitation  the rights to  use, copy, modify,  merge, publish,
distribute,  sublicense, and/or sell  copies of  the Software,  and to
permit persons to whom the Software  is furnished to do so, subject to
the following conditions:

The  above  copyright  notice  and  this permission  notice  shall  be
included in all copies or substantial portions of the Software.

THE  SOFTWARE IS  PROVIDED  "AS  IS", WITHOUT  WARRANTY  OF ANY  KIND,
EXPRESS OR  IMPLIED, INCLUDING  BUT NOT LIMITED  TO THE  WARRANTIES OF
MERCHANTABILITY,    FITNESS    FOR    A   PARTICULAR    PURPOSE    AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE,  ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Components whose official artifact carries no licence file

These nine artifacts embed no licence text. For the six components with one declared licence,
the source tree's licence file at the pinned version is included in `components/`. Four are
byte-for-byte copies. The args4j copy omits only three blank lines at EOF, and the JZlib copy
removes only trailing spaces on four lines; the licence wording is unchanged. SHA-256 below
identifies the **included** file:

| Component                                    | Versioned upstream source                                                                    | Included text                               | SHA-256                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `args4j:args4j:2.33`                         | [module licence](https://github.com/kohsuke/args4j/blob/args4j-site-2.33/args4j/LICENSE.txt) | `components/args4j-2.33.LICENSE.txt`        | `a68bec3102486fec043d2171ac82895202e5ccca7dfd265ac60403e0b27ea458` |
| `com.github.luben:zstd-jni:1.5.6-1`          | [licence](https://github.com/luben/zstd-jni/blob/v1.5.6-1/LICENSE)                           | `components/zstd-jni-1.5.6-1.LICENSE`       | `c6a6a8926f2f1732603e4b75779a5f6ce79238eb79bc36dcc5b7feb509bc6cd9` |
| `com.google.protobuf:protobuf-java:3.25.8`   | [licence](https://github.com/protocolbuffers/protobuf/blob/v3.25.8/LICENSE)                  | `components/protobuf-java-3.25.8.LICENSE`   | `6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d` |
| `com.jcraft:jzlib:1.1.3`                     | [licence](https://github.com/ymnk/jzlib/blob/1.1.3/LICENSE.txt)                              | `components/jzlib-1.1.3.LICENSE.txt`        | `5fa73d69e1b4138fa344c1ad3fe9a6f9e0b412756c7be6807b24110b41b4a75a` |
| `net.sf.jopt-simple:jopt-simple:5.0.4`       | [licence](https://github.com/jopt-simple/jopt-simple/blob/jopt-simple-5.0.4/LICENSE.txt)     | `components/jopt-simple-5.0.4.LICENSE.txt`  | `91d37fd637f457bd1f95b288f8eb6d33df6ea9de7a76e766ec8cf71f2bf71406` |
| `org.reactivestreams:reactive-streams:1.0.4` | [licence](https://github.com/reactive-streams/reactive-streams-jvm/blob/v1.0.4/LICENSE)      | `components/reactive-streams-1.0.4.LICENSE` | `96a3b2d45af72054d0676e8eb9a944a096812a7f8ff1b71bd82dadbc60ce0444` |

The upstream SHA-256 values before whitespace normalization are
`6b18ac8f4bd928d82645af377e78db4f461e97c3ad81bd236a38f8b862531e0d`
for args4j and `9aa93e9bc58ae423a9e6476f608ee8f46063f5679e3bac0bc55f2f4b10d243ee`
for JZlib.

The other three offer a choice of licences. The versioned upstream texts and notices for
`jakarta.servlet:jakarta.servlet-api:6.0.0`, `org.locationtech.jts:jts-core:1.20.0`, and
`org.locationtech.jts.io:jts-io-common:1.20.0` are included below. Both JTS artifacts use the
same tagged upstream source. The included files have only trailing whitespace and EOF
normalization where needed; their licence wording has not changed. SHA-256 identifies the
**included** file:

| Upstream source                                                                                                  | Included text                                      | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| [JTS licensing overview, tag 1.20.0](https://github.com/locationtech/jts/blob/1.20.0/LICENSES.md)                | `components/jts-1.20.0/LICENSES.txt`               | `dc8145c6d2a95160b8e9a49a4b080552bd821fff1879fcabc32416d583997041` |
| [JTS Eclipse Distribution License 1.0](https://github.com/locationtech/jts/blob/1.20.0/LICENSE_EDLv1.txt)        | `components/jts-1.20.0/LICENSE_EDLv1.txt`          | `e67a91b5489cd78292d2654f1b587fe68296e28df7c766b9b675614fbdce4fd1` |
| [JTS Eclipse Public License 2.0](https://github.com/locationtech/jts/blob/1.20.0/LICENSE_EPLv2.txt)              | `components/jts-1.20.0/LICENSE_EPLv2.txt`          | `8c349f80764d0648e645f41ef23772a70c995a0924b5235f735f4a3d09df127c` |
| [JTS OSGeo BSD licence](https://github.com/locationtech/jts/blob/1.20.0/OSGEO_LICENSE.txt)                       | `components/jts-1.20.0/OSGEO_LICENSE.txt`          | `4f8fc9d0a3fccd751f9ba025de07896c9aa2ef49c7eb16addf4dc021f06ba64a` |
| [Jakarta Servlet licence, tag 6.0.0-RELEASE](https://github.com/jakartaee/servlet/blob/6.0.0-RELEASE/LICENSE.md) | `components/jakarta.servlet-api-6.0.0/LICENSE.txt` | `2bfa89e57dd3034b419eea6d273ac79d7006c88c5bef6bc7df4aea0dfc355716` |
| [Jakarta Servlet notice, tag 6.0.0-RELEASE](https://github.com/jakartaee/servlet/blob/6.0.0-RELEASE/NOTICE.md)   | `components/jakarta.servlet-api-6.0.0/NOTICE.txt`  | `6cf6b2dbeb627d0bb755764e4caacb75f9dcf280f75f2a56764d31b12e2261f8` |

The original upstream SHA-256 before whitespace normalization was
`860b6249d7688b4b84b56c47601c031c96d8317e8289e0f4192e9fa3228ce714` for JTS
`LICENSES.md`, `0becf16567beb77fa252b7664631dd177c8f9a1889e48995b45379c7130e5303`
for JTS `LICENSE_EPLv2.txt`, `a215d9af48d7ec9b9d72328cde3b6d6a22ee45d4b9d246962ccdbe62511f0acc`
for JTS `OSGEO_LICENSE.txt`, `6e1f002892b81cbe0647019b150c8a056efc1add565671a4f8af629b6cd2cc7b`
for Servlet `LICENSE.md`, and `dc367b4a1a4c321c4f90001646c182d904583b410339fa22caef27b75eaeff47`
for Servlet `NOTICE.md`. JTS `LICENSE_EDLv1.txt` is byte-for-byte unchanged.

Including the alternatives does not elect one. The owner must record the licence choices and
review the resulting distribution obligations before any image distribution:

- `jakarta.servlet:jakarta.servlet-api:6.0.0`: EPL 2.0; GPL2 w/ CPE
- `org.locationtech.jts:jts-core:1.20.0`: Eclipse Public License, Version 2.0; Eclipse Distribution License - v 1.0
- `org.locationtech.jts.io:jts-io-common:1.20.0`: Eclipse Public License, Version 2.0; Eclipse Distribution License - v 1.0
