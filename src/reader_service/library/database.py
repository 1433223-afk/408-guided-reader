from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from reader_service.learning.schema import (
    SCHEMA as LEARNING_SCHEMA,
    MASTER_REASONING_SCHEMA,
    SECTION_SCHEMA,
    STABLE_TOPIC_SCHEMA,
)


MIGRATIONS = (
    (
        1,
        """
        CREATE TABLE books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'DELETING', 'DELETE_FAILED')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE book_source_revisions (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            blob_sha256 TEXT NOT NULL,
            byte_size INTEGER NOT NULL CHECK (byte_size > 0),
            page_count INTEGER NOT NULL CHECK (page_count > 0),
            page_geometry_json TEXT NOT NULL,
            label TEXT NOT NULL,
            status TEXT NOT NULL
                CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'DELETING', 'DELETE_FAILED', 'DELETED')),
            created_at TEXT NOT NULL,
            UNIQUE (book_id, blob_sha256)
        );
        CREATE INDEX ix_source_revisions_blob ON book_source_revisions(blob_sha256);
        CREATE UNIQUE INDEX ux_one_active_revision_per_book
            ON book_source_revisions(book_id) WHERE status = 'ACTIVE';

        CREATE TABLE reading_positions (
            book_source_revision_id TEXT PRIMARY KEY
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            normalized_offset REAL NOT NULL CHECK (normalized_offset >= 0 AND normalized_offset <= 1),
            zoom REAL NOT NULL CHECK (zoom >= 0.5 AND zoom <= 4),
            updated_at TEXT NOT NULL
        );
        """,
    ),
    (
        2,
        """
        ALTER TABLE book_source_revisions
            ADD COLUMN foundation_version INTEGER NOT NULL DEFAULT 1
            CHECK (foundation_version >= 1);

        CREATE TABLE ocr_pages (
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            status TEXT NOT NULL DEFAULT 'NOT_PREPARED'
                CHECK (status IN ('NOT_PREPARED', 'PREPARING', 'READY', 'FAILED')),
            route TEXT CHECK (route IS NULL OR route IN ('EMBEDDED', 'OCR')),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            engine_profile TEXT,
            confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
            prepared_at TEXT,
            failure_code TEXT,
            PRIMARY KEY (book_source_revision_id, pdf_page_index)
        );
        CREATE INDEX ix_ocr_pages_revision_status
            ON ocr_pages(book_source_revision_id, status, pdf_page_index);

        CREATE TABLE ocr_lines (
            book_source_revision_id TEXT NOT NULL,
            pdf_page_index INTEGER NOT NULL,
            line_ordinal INTEGER NOT NULL CHECK (line_ordinal >= 0),
            quad_json TEXT NOT NULL,
            text TEXT NOT NULL,
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            cells_json TEXT NOT NULL,
            PRIMARY KEY (book_source_revision_id, pdf_page_index, line_ordinal),
            FOREIGN KEY (book_source_revision_id, pdf_page_index)
                REFERENCES ocr_pages(book_source_revision_id, pdf_page_index)
                ON DELETE CASCADE
        );

        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL CHECK (job_type = 'PAGE_PREPARE'),
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            page_start INTEGER NOT NULL CHECK (page_start >= 0),
            page_end INTEGER NOT NULL CHECK (page_end >= page_start),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            status TEXT NOT NULL
                CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED')),
            priority INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (
                job_type, book_source_revision_id, page_start, page_end, foundation_version
            )
        );
        CREATE INDEX ix_jobs_claim
            ON jobs(status, cancel_requested, priority DESC, created_at);
        """,
    ),
    (
        3,
        """
        -- R2 pre-anchor compatibility reset.  Earlier prepared geometry used a
        -- Y-only hit-test reading order and an unsafe embedded-text transform.
        -- No user anchor assets exist yet, so invalidate only the active
        -- machine layer and reuse the baseline foundation version.
        DELETE FROM ocr_lines
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );

        UPDATE ocr_pages
        SET status = 'NOT_PREPARED', route = NULL, engine_profile = NULL,
            confidence = NULL, prepared_at = NULL, failure_code = NULL
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );

        UPDATE jobs
        SET status = 'QUEUED', priority = 0, cancel_requested = 0, attempts = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );
        """,
    ),
    (
        4,
        """
        CREATE TABLE annotations (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind = 'TEXT'),
            quads_json TEXT NOT NULL,
            quote TEXT NOT NULL CHECK (length(quote) > 0),
            context_before TEXT NOT NULL,
            context_after TEXT NOT NULL,
            foundation_version_at_creation INTEGER NOT NULL
                CHECK (foundation_version_at_creation >= 1),
            body TEXT CHECK (body IS NULL OR (length(body) > 0 AND length(body) <= 1000)),
            highlight_style TEXT NOT NULL DEFAULT 'YELLOW'
                CHECK (highlight_style = 'YELLOW'),
            source_kind TEXT NOT NULL DEFAULT 'USER' CHECK (source_kind = 'USER'),
            verification_state TEXT CHECK (verification_state IS NULL),
            anchor_state TEXT NOT NULL DEFAULT 'OK' CHECK (anchor_state = 'OK'),
            knowledge_point_id TEXT CHECK (knowledge_point_id IS NULL),
            created_at TEXT NOT NULL
        );
        CREATE INDEX ix_annotations_revision_page
            ON annotations(book_source_revision_id, pdf_page_index, created_at, id);
        """,
    ),
    (
        5,
        """
        -- Annotation highlight style is presentation data, independent from
        -- both the durable text anchor and the optional note body. Rebuild the
        -- table so existing user assets survive while the R3 UI gains a small,
        -- explicitly bounded palette including no visible paint.
        CREATE TABLE annotations_v5 (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind = 'TEXT'),
            quads_json TEXT NOT NULL,
            quote TEXT NOT NULL CHECK (length(quote) > 0),
            context_before TEXT NOT NULL,
            context_after TEXT NOT NULL,
            foundation_version_at_creation INTEGER NOT NULL
                CHECK (foundation_version_at_creation >= 1),
            body TEXT CHECK (body IS NULL OR (length(body) > 0 AND length(body) <= 1000)),
            highlight_style TEXT NOT NULL DEFAULT 'YELLOW'
                CHECK (highlight_style IN ('YELLOW', 'GREEN', 'BLUE', 'NONE')),
            source_kind TEXT NOT NULL DEFAULT 'USER' CHECK (source_kind = 'USER'),
            verification_state TEXT CHECK (verification_state IS NULL),
            anchor_state TEXT NOT NULL DEFAULT 'OK' CHECK (anchor_state = 'OK'),
            knowledge_point_id TEXT CHECK (knowledge_point_id IS NULL),
            created_at TEXT NOT NULL
        );

        INSERT INTO annotations_v5(
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, created_at
        )
        SELECT
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, created_at
        FROM annotations;

        DROP TABLE annotations;
        ALTER TABLE annotations_v5 RENAME TO annotations;
        CREATE INDEX ix_annotations_revision_page
            ON annotations(book_source_revision_id, pdf_page_index, created_at, id);
        """,
    ),
    (
        6,
        """
        CREATE TABLE page_labels (
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            printed_label TEXT,
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            method TEXT NOT NULL CHECK (method IN ('INFERRED', 'MANUAL', 'NONE')),
            evidence_ref TEXT,
            PRIMARY KEY (book_source_revision_id, pdf_page_index)
        );
        CREATE INDEX ix_page_labels_revision_label
            ON page_labels(book_source_revision_id, printed_label);

        CREATE TABLE outline_nodes (
            outline_node_id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            identity_revision INTEGER NOT NULL DEFAULT 1 CHECK (identity_revision >= 1),
            parent_id TEXT,
            depth INTEGER NOT NULL CHECK (depth >= 0),
            order_index INTEGER NOT NULL CHECK (order_index >= 0),
            kind TEXT NOT NULL CHECK (kind IN (
                'CHAPTER', 'SECTION', 'SUBSECTION', 'EXERCISES', 'ANSWERS',
                'FRONT_MATTER', 'OTHER'
            )),
            title TEXT NOT NULL CHECK (length(title) > 0),
            printed_label_hint TEXT,
            start_page INTEGER CHECK (start_page IS NULL OR start_page >= 0),
            start_y REAL CHECK (start_y IS NULL OR (start_y >= 0 AND start_y <= 1)),
            end_page INTEGER CHECK (end_page IS NULL OR end_page >= 0),
            end_y REAL CHECK (end_y IS NULL OR (end_y >= 0 AND end_y <= 1)),
            resolution_state TEXT NOT NULL
                CHECK (resolution_state IN ('UNRESOLVED', 'PARTIAL', 'RESOLVED')),
            physical_revision INTEGER NOT NULL DEFAULT 1 CHECK (physical_revision >= 1),
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            evidence_json TEXT NOT NULL,
            UNIQUE (book_source_revision_id, outline_node_id),
            UNIQUE (book_source_revision_id, parent_id, order_index),
            FOREIGN KEY (book_source_revision_id, parent_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE
        );
        CREATE INDEX ix_outline_nodes_revision_order
            ON outline_nodes(book_source_revision_id, depth, order_index);

        CREATE TABLE outline_bootstrap_records (
            book_source_revision_id TEXT PRIMARY KEY
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            parser_version TEXT NOT NULL,
            evidence_source TEXT NOT NULL CHECK (evidence_source IN ('BOOKMARK', 'TOC')),
            evidence_digest TEXT NOT NULL,
            structure_digest TEXT NOT NULL,
            last_conflict_digest TEXT,
            committed_at TEXT NOT NULL
        );
        """,
    ),
    (
        7,
        """
        -- Save-to-Notes promotes exactly one completed Assistant answer into
        -- Annotation.  The rebuild widens only the already-reserved AI_SAVED
        -- path while copying every existing USER field one-for-one.
        CREATE TABLE annotations_v7 (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind = 'TEXT'),
            quads_json TEXT NOT NULL,
            quote TEXT NOT NULL CHECK (length(quote) > 0),
            context_before TEXT NOT NULL,
            context_after TEXT NOT NULL,
            foundation_version_at_creation INTEGER NOT NULL
                CHECK (foundation_version_at_creation >= 1),
            body TEXT,
            highlight_style TEXT NOT NULL DEFAULT 'YELLOW'
                CHECK (highlight_style IN ('YELLOW', 'GREEN', 'BLUE', 'NONE')),
            source_kind TEXT NOT NULL DEFAULT 'USER'
                CHECK (source_kind IN ('USER', 'AI_SAVED')),
            verification_state TEXT,
            anchor_state TEXT NOT NULL DEFAULT 'OK' CHECK (anchor_state = 'OK'),
            knowledge_point_id TEXT CHECK (knowledge_point_id IS NULL),
            save_intent_id TEXT UNIQUE,
            provenance_json TEXT,
            source_grounding_json TEXT,
            review_provider TEXT,
            review_model TEXT,
            review_failure_kind TEXT,
            review_code TEXT,
            review_summary TEXT CHECK (
                review_summary IS NULL OR length(review_summary) <= 1000
            ),
            reviewed_at TEXT,
            created_at TEXT NOT NULL,
            CHECK (
                (source_kind = 'USER'
                    AND (body IS NULL OR (length(body) > 0 AND length(body) <= 1000))
                    AND verification_state IS NULL
                    AND save_intent_id IS NULL
                    AND provenance_json IS NULL
                    AND source_grounding_json IS NULL
                    AND review_provider IS NULL
                    AND review_model IS NULL
                    AND review_failure_kind IS NULL
                    AND review_code IS NULL
                    AND review_summary IS NULL
                    AND reviewed_at IS NULL)
                OR
                (source_kind = 'AI_SAVED'
                    AND body IS NOT NULL
                    AND length(body) > 0
                    AND length(body) <= 100000
                    AND highlight_style = 'NONE'
                    AND verification_state IN (
                        'PENDING', 'PASS', 'FAIL', 'TECHNICAL_FAILURE'
                    )
                    AND save_intent_id IS NOT NULL
                    AND length(save_intent_id) BETWEEN 8 AND 128
                    AND provenance_json IS NOT NULL
                    AND source_grounding_json IS NOT NULL)
            )
        );

        INSERT INTO annotations_v7(
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, save_intent_id, provenance_json,
            source_grounding_json, review_provider, review_model,
            review_failure_kind, review_code, review_summary, reviewed_at, created_at
        )
        SELECT
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
            NULL, created_at
        FROM annotations;

        DROP TABLE annotations;
        ALTER TABLE annotations_v7 RENAME TO annotations;
        CREATE INDEX ix_annotations_revision_page
            ON annotations(book_source_revision_id, pdf_page_index, created_at, id);
        """,
    ),
    (
        8,
        """
        -- Widen the existing durable job substrate for one Chapter-scoped
        -- Knowledge preparation job.  Existing page jobs are copied exactly;
        -- the two partial unique indexes keep the job identities scoped to
        -- their real unit of work.
        CREATE TABLE jobs_v8 (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL
                CHECK (job_type IN ('PAGE_PREPARE', 'CHAPTER_PREPARE')),
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            page_start INTEGER CHECK (page_start IS NULL OR page_start >= 0),
            page_end INTEGER CHECK (
                page_end IS NULL OR (page_start IS NOT NULL AND page_end >= page_start)
            ),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            chapter_outline_node_id TEXT,
            chapter_identity_revision INTEGER
                CHECK (chapter_identity_revision IS NULL OR chapter_identity_revision >= 1),
            chapter_physical_revision INTEGER
                CHECK (chapter_physical_revision IS NULL OR chapter_physical_revision >= 1),
            status TEXT NOT NULL
                CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED')),
            priority INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (
                (job_type = 'PAGE_PREPARE'
                    AND page_start IS NOT NULL AND page_end IS NOT NULL
                    AND chapter_outline_node_id IS NULL
                    AND chapter_identity_revision IS NULL
                    AND chapter_physical_revision IS NULL)
                OR
                (job_type = 'CHAPTER_PREPARE'
                    AND page_start IS NULL AND page_end IS NULL
                    AND chapter_outline_node_id IS NOT NULL
                    AND chapter_identity_revision IS NOT NULL
                    AND chapter_physical_revision IS NOT NULL)
            ),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE
        );

        INSERT INTO jobs_v8(
            id, job_type, book_source_revision_id, page_start, page_end,
            foundation_version, chapter_outline_node_id,
            chapter_identity_revision, chapter_physical_revision,
            status, priority, cancel_requested, attempts, created_at, updated_at
        )
        SELECT
            id, job_type, book_source_revision_id, page_start, page_end,
            foundation_version, NULL, NULL, NULL,
            status, priority, cancel_requested, attempts, created_at, updated_at
        FROM jobs;

        DROP TABLE jobs;
        ALTER TABLE jobs_v8 RENAME TO jobs;
        CREATE INDEX ix_jobs_claim
            ON jobs(status, cancel_requested, priority DESC, created_at);
        CREATE UNIQUE INDEX ux_jobs_page_prepare
            ON jobs(job_type, book_source_revision_id, page_start, page_end, foundation_version)
            WHERE job_type = 'PAGE_PREPARE';
        CREATE UNIQUE INDEX ux_jobs_chapter_prepare
            ON jobs(
                job_type, book_source_revision_id, chapter_outline_node_id,
                foundation_version, chapter_identity_revision, chapter_physical_revision
            ) WHERE job_type = 'CHAPTER_PREPARE';

        CREATE TABLE chapter_preparations (
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            chapter_outline_node_id TEXT NOT NULL,
            status TEXT NOT NULL
                CHECK (status IN ('PREPARING', 'READY', 'FAILED')),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            chapter_identity_revision INTEGER NOT NULL CHECK (chapter_identity_revision >= 1),
            chapter_physical_revision INTEGER NOT NULL CHECK (chapter_physical_revision >= 1),
            structure_version INTEGER NOT NULL DEFAULT 0 CHECK (structure_version >= 0),
            attempt_id TEXT NOT NULL,
            generator_provider TEXT,
            generator_model TEXT,
            reviewer_provider TEXT,
            reviewer_model TEXT,
            review_summary TEXT CHECK (
                review_summary IS NULL OR length(review_summary) <= 1000
            ),
            failure_stage TEXT,
            failure_kind TEXT,
            failure_code TEXT,
            source_payload_sha256 TEXT,
            review_payload_sha256 TEXT,
            requested_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT,
            PRIMARY KEY (book_source_revision_id, chapter_outline_node_id),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE,
            CHECK (
                status != 'READY'
                OR (
                    structure_version >= 1
                    AND generator_provider IS NOT NULL
                    AND generator_model IS NOT NULL
                    AND reviewer_provider IS NOT NULL
                    AND reviewer_model IS NOT NULL
                    AND published_at IS NOT NULL
                    AND failure_stage IS NULL
                    AND failure_kind IS NULL
                    AND failure_code IS NULL
                )
            )
        );

        CREATE TABLE knowledge_points (
            knowledge_point_id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL,
            chapter_outline_node_id TEXT NOT NULL,
            chapter_structure_version INTEGER NOT NULL
                CHECK (chapter_structure_version >= 1),
            primary_section_id TEXT NOT NULL,
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
            one_sentence_definition TEXT NOT NULL
                CHECK (length(one_sentence_definition) BETWEEN 1 AND 1000),
            order_index INTEGER NOT NULL CHECK (order_index >= 0),
            start_page INTEGER NOT NULL CHECK (start_page >= 0),
            start_y REAL NOT NULL CHECK (start_y >= 0 AND start_y <= 1),
            end_page INTEGER NOT NULL CHECK (end_page >= start_page),
            end_y REAL NOT NULL CHECK (end_y >= 0 AND end_y <= 1),
            source_foundation_version INTEGER NOT NULL
                CHECK (source_foundation_version >= 1),
            created_at TEXT NOT NULL,
            UNIQUE (
                book_source_revision_id, chapter_outline_node_id,
                chapter_structure_version, order_index
            ),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES chapter_preparations(
                    book_source_revision_id, chapter_outline_node_id
                ) ON DELETE CASCADE,
            FOREIGN KEY (book_source_revision_id, primary_section_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
        );
        CREATE INDEX ix_knowledge_points_chapter_section
            ON knowledge_points(
                book_source_revision_id, chapter_outline_node_id,
                chapter_structure_version, primary_section_id, order_index
            );
        """,
    ),
    (
        9,
        """
        -- UAT diagnostics remain operational metadata: Chapter progress never
        -- contains private candidate content, and provider attempt rows retain
        -- only bounded route/timing/shape/failure facts.
        ALTER TABLE chapter_preparations ADD COLUMN prepare_stage TEXT
            CHECK (prepare_stage IS NULL OR prepare_stage IN (
                'QUEUED', 'RESOLVING_SOURCE', 'GENERATING', 'REVIEWING',
                'VALIDATING', 'PUBLISHING'
            ));
        ALTER TABLE chapter_preparations ADD COLUMN sections_completed INTEGER
            NOT NULL DEFAULT 0 CHECK (sections_completed >= 0);
        ALTER TABLE chapter_preparations ADD COLUMN sections_total INTEGER
            NOT NULL DEFAULT 0 CHECK (sections_total >= 0);
        UPDATE chapter_preparations
        SET prepare_stage = CASE WHEN status = 'PREPARING' THEN 'QUEUED' ELSE NULL END;

        CREATE TABLE chapter_generation_attempts (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL,
            chapter_outline_node_id TEXT NOT NULL,
            preparation_attempt_id TEXT NOT NULL,
            primary_section_id TEXT NOT NULL,
            structured_attempt INTEGER NOT NULL CHECK (structured_attempt >= 1),
            transport_attempt INTEGER NOT NULL CHECK (transport_attempt >= 1),
            interaction_id TEXT NOT NULL CHECK (length(interaction_id) BETWEEN 1 AND 300),
            provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
            model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
            provider_role TEXT NOT NULL CHECK (provider_role = 'KP_GENERATOR'),
            pipeline_stage TEXT NOT NULL CHECK (pipeline_stage = 'GENERATION'),
            status TEXT NOT NULL CHECK (
                status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')
            ),
            started_at TEXT NOT NULL,
            completed_at TEXT,
            latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
            finish_reason TEXT CHECK (
                finish_reason IS NULL OR length(finish_reason) <= 120
            ),
            prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
            completion_tokens INTEGER CHECK (
                completion_tokens IS NULL OR completion_tokens >= 0
            ),
            total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
            content_present INTEGER CHECK (content_present IN (0, 1)),
            content_length INTEGER CHECK (content_length IS NULL OR content_length >= 0),
            reasoning_present INTEGER CHECK (reasoning_present IN (0, 1)),
            reasoning_length INTEGER CHECK (
                reasoning_length IS NULL OR reasoning_length >= 0
            ),
            failure_kind TEXT CHECK (
                failure_kind IS NULL OR length(failure_kind) <= 80
            ),
            failure_code TEXT CHECK (
                failure_code IS NULL OR length(failure_code) <= 120
            ),
            UNIQUE (
                book_source_revision_id, chapter_outline_node_id,
                preparation_attempt_id, primary_section_id,
                structured_attempt, transport_attempt
            ),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES chapter_preparations(
                    book_source_revision_id, chapter_outline_node_id
                ) ON DELETE CASCADE,
            FOREIGN KEY (book_source_revision_id, primary_section_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE
        );
        CREATE INDEX ix_chapter_generation_attempts_owner
            ON chapter_generation_attempts(
                book_source_revision_id, chapter_outline_node_id,
                preparation_attempt_id, started_at
            );
        """,
    ),
    (
        10,
        """
        -- The corrected semantic pipeline observes bounded packet and Review
        -- attempts without retaining source text, private candidates, request
        -- or response bodies.  Review is Chapter-scoped, so Section ownership
        -- is intentionally nullable for those rows.
        CREATE TABLE chapter_pipeline_attempts (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL,
            chapter_outline_node_id TEXT NOT NULL,
            preparation_attempt_id TEXT NOT NULL,
            primary_section_id TEXT,
            packet_or_stage_id TEXT NOT NULL
                CHECK (length(packet_or_stage_id) BETWEEN 1 AND 160),
            semantic_round INTEGER NOT NULL DEFAULT 0 CHECK (semantic_round >= 0),
            structured_attempt INTEGER NOT NULL CHECK (structured_attempt >= 1),
            transport_attempt INTEGER NOT NULL CHECK (transport_attempt >= 1),
            interaction_id TEXT NOT NULL CHECK (length(interaction_id) BETWEEN 1 AND 300),
            provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
            model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
            provider_role TEXT NOT NULL CHECK (
                provider_role IN ('KP_GENERATOR', 'KP_STRUCTURAL_REVIEWER')
            ),
            pipeline_stage TEXT NOT NULL CHECK (
                pipeline_stage IN (
                    'LEGACY_GENERATION', 'SEMANTIC_CLASSIFICATION',
                    'STRUCTURAL_REVIEW'
                )
            ),
            status TEXT NOT NULL CHECK (
                status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')
            ),
            started_at TEXT NOT NULL,
            completed_at TEXT,
            latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
            finish_reason TEXT CHECK (
                finish_reason IS NULL OR length(finish_reason) <= 120
            ),
            prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
            completion_tokens INTEGER CHECK (
                completion_tokens IS NULL OR completion_tokens >= 0
            ),
            total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
            content_present INTEGER CHECK (content_present IN (0, 1)),
            content_length INTEGER CHECK (content_length IS NULL OR content_length >= 0),
            reasoning_present INTEGER CHECK (reasoning_present IN (0, 1)),
            reasoning_length INTEGER CHECK (
                reasoning_length IS NULL OR reasoning_length >= 0
            ),
            failure_kind TEXT CHECK (
                failure_kind IS NULL OR length(failure_kind) <= 80
            ),
            failure_code TEXT CHECK (
                failure_code IS NULL OR length(failure_code) <= 120
            ),
            UNIQUE (
                book_source_revision_id, chapter_outline_node_id,
                preparation_attempt_id, pipeline_stage, packet_or_stage_id,
                semantic_round, structured_attempt, transport_attempt
            ),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES chapter_preparations(
                    book_source_revision_id, chapter_outline_node_id
                ) ON DELETE CASCADE,
            FOREIGN KEY (book_source_revision_id, primary_section_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE
        );

        INSERT INTO chapter_pipeline_attempts(
            id, book_source_revision_id, chapter_outline_node_id,
            preparation_attempt_id, primary_section_id, packet_or_stage_id,
            semantic_round, structured_attempt, transport_attempt,
            interaction_id, provider, model, provider_role, pipeline_stage,
            status, started_at, completed_at, latency_ms, finish_reason,
            prompt_tokens, completion_tokens, total_tokens, content_present,
            content_length, reasoning_present, reasoning_length,
            failure_kind, failure_code
        )
        SELECT
            id, book_source_revision_id, chapter_outline_node_id,
            preparation_attempt_id, primary_section_id, primary_section_id,
            0, structured_attempt, transport_attempt,
            interaction_id, provider, model, provider_role, 'LEGACY_GENERATION',
            status, started_at, completed_at, latency_ms, finish_reason,
            prompt_tokens, completion_tokens, total_tokens, content_present,
            content_length, reasoning_present, reasoning_length,
            failure_kind, failure_code
        FROM chapter_generation_attempts;

        DROP TABLE chapter_generation_attempts;
        CREATE INDEX ix_chapter_pipeline_attempts_owner
            ON chapter_pipeline_attempts(
                book_source_revision_id, chapter_outline_node_id,
                preparation_attempt_id, started_at
            );
        """,
    ),
    (
        11,
        """
        -- READY Chapter replacement keeps the published snapshot available
        -- while a private replacement attempt runs.  The learning marker is
        -- irreversible: current-state deletion/reset can never unlock IDs that
        -- have already carried learning history.
        ALTER TABLE chapter_preparations ADD COLUMN regeneration_state TEXT
            NOT NULL DEFAULT 'IDLE'
            CHECK (regeneration_state IN ('IDLE', 'RUNNING', 'FAILED'));
        ALTER TABLE chapter_preparations ADD COLUMN regeneration_failure_stage TEXT;
        ALTER TABLE chapter_preparations ADD COLUMN regeneration_failure_kind TEXT;
        ALTER TABLE chapter_preparations ADD COLUMN regeneration_failure_code TEXT;
        ALTER TABLE chapter_preparations ADD COLUMN attempt_foundation_version INTEGER
            CHECK (attempt_foundation_version IS NULL OR attempt_foundation_version >= 1);
        ALTER TABLE chapter_preparations ADD COLUMN attempt_chapter_identity_revision INTEGER
            CHECK (
                attempt_chapter_identity_revision IS NULL
                OR attempt_chapter_identity_revision >= 1
            );
        ALTER TABLE chapter_preparations ADD COLUMN attempt_chapter_physical_revision INTEGER
            CHECK (
                attempt_chapter_physical_revision IS NULL
                OR attempt_chapter_physical_revision >= 1
            );
        ALTER TABLE chapter_preparations ADD COLUMN learning_state_ever_at TEXT;

        UPDATE chapter_preparations
        SET attempt_foundation_version = foundation_version,
            attempt_chapter_identity_revision = chapter_identity_revision,
            attempt_chapter_physical_revision = chapter_physical_revision;

        CREATE TRIGGER chapter_learning_lock_is_irreversible
        BEFORE UPDATE OF learning_state_ever_at ON chapter_preparations
        WHEN OLD.learning_state_ever_at IS NOT NULL
             AND NEW.learning_state_ever_at IS NOT OLD.learning_state_ever_at
        BEGIN
            SELECT RAISE(ABORT, 'Chapter learning lock is irreversible');
        END;
        """,
    ),
)


from reader_service.teaching.schema import TEACHING_SCHEMA, INLINE_TEACHING_SCHEMA
from reader_service.memory_schema import SCHEMA as MEMORY_SCHEMA
from reader_service.learning.reading import SCHEMA as READING_SCHEMA

MIGRATIONS = (*MIGRATIONS, (12, LEARNING_SCHEMA), (13, SECTION_SCHEMA), (14, TEACHING_SCHEMA), (15, INLINE_TEACHING_SCHEMA), (16, MEMORY_SCHEMA), (17, READING_SCHEMA), (18, STABLE_TOPIC_SCHEMA), (19, MASTER_REASONING_SCHEMA))


class Database:
    def __init__(self, path: Path):
        self.path = path

    def initialize(self) -> None:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        # Journal mode is a database-level setting. Set it once before worker
        # threads start; repeating this pragma on every connection can itself
        # contend with an active writer and raise "database is locked".
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            applied = {
                row[0] for row in connection.execute("SELECT version FROM schema_migrations")
            }
            for version, sql in MIGRATIONS:
                if version in applied:
                    continue
                if version == 7:
                    self._backup_durable_annotations(connection, version)
                if version == 16:
                    self._backup_learning_memory(connection)
                if version == 17:
                    self._backup_learning_memory(connection, 17)
                if version == 18:
                    self._backup_master_topics(connection, version)
                if version == 19:
                    self._backup_master_execution_settings(connection, version)
                if version == 13:
                    # SQLite's documented table-rebuild procedure: disable cascades outside
                    # the transaction, preserve IDs, and validate all FKs before committing.
                    connection.execute("PRAGMA foreign_keys = OFF")
                    connection.executescript(f"BEGIN IMMEDIATE;\n{sql}\nINSERT INTO schema_migrations(version) VALUES (13);")
                    if connection.execute("PRAGMA foreign_key_check").fetchone():
                        raise RuntimeError("Section Master migration failed foreign-key validation")
                    connection.commit()
                    connection.execute("PRAGMA foreign_keys = ON")
                    continue
                # executescript does not add a transaction of its own. Keep the
                # schema change and its migration marker atomic, which is
                # especially important once migrations preserve user assets.
                connection.executescript(
                    f"BEGIN IMMEDIATE;\n{sql}\n"
                    f"INSERT INTO schema_migrations(version) VALUES ({int(version)});\nCOMMIT;"
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _backup_master_topics(self, connection, version):
        backup_path = self.path.with_name(f"{self.path.name}.pre-migration-{version}.bak")
        destination = sqlite3.connect(backup_path)
        try:
            connection.backup(destination)
            destination.commit()
            if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Master Topic backup failed integrity verification")
            if list(destination.iterdump()) != list(connection.iterdump()):
                raise RuntimeError("Master Topic backup differs from existing data")
        finally:
            destination.close()
        print(
            "数据升级：已验证备份；合并同一学习范围的重复 Master 话题，保留对话、学习历史、记忆与掌握状态。",
            flush=True,
        )

    def _backup_master_execution_settings(self, connection, version):
        backup_path = self.path.with_name(f"{self.path.name}.pre-migration-{version}.bak")
        destination = sqlite3.connect(backup_path)
        try:
            connection.backup(destination)
            destination.commit()
            if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Master execution settings backup failed integrity verification")
            if list(destination.iterdump()) != list(connection.iterdump()):
                raise RuntimeError("Master execution settings backup differs from existing data")
        finally:
            destination.close()
        print(
            "数据升级：已验证备份；为 Master 消息增加回答推理模式，保留话题、对话、审查与掌握状态。",
            flush=True,
        )

    def _backup_learning_memory(self, connection, version=16):
        backup_path = self.path.with_name(f"{self.path.name}.pre-migration-{version}.bak")
        destination = sqlite3.connect(backup_path)
        try:
            connection.backup(destination)
            if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Learning Memory backup failed integrity verification')
            if list(destination.iterdump()) != list(connection.iterdump()):
                raise RuntimeError('Learning Memory backup differs from existing data')
        finally:
            destination.close()
        print('数据升级：已验证备份；新增节末阅读记录，不修改掌握状态、历史、对话或笔记。' if version == 17 else '数据升级：已验证备份；新增学习记忆收录关系，保留原对话、笔记和学习状态。', flush=True)

    def _backup_durable_annotations(
        self, connection: sqlite3.Connection, migration_version: int
    ) -> None:
        table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'annotations'"
        ).fetchone()
        if table is None:
            return
        source_count = int(
            connection.execute("SELECT COUNT(*) FROM annotations").fetchone()[0]
        )
        if source_count == 0:
            return
        backup_path = self.path.with_name(
            f"{self.path.name}.pre-migration-{migration_version}.bak"
        )
        if not backup_path.exists():
            destination = sqlite3.connect(backup_path)
            try:
                connection.backup(destination)
                destination.commit()
            finally:
                destination.close()
        verification = sqlite3.connect(backup_path)
        try:
            integrity = verification.execute("PRAGMA integrity_check").fetchone()[0]
            backup_count = int(
                verification.execute("SELECT COUNT(*) FROM annotations").fetchone()[0]
            )
        finally:
            verification.close()
        if integrity != "ok" or backup_count != source_count:
            raise RuntimeError(
                f"Durable Annotation backup verification failed before migration {migration_version}"
            )
        print(
            "DATA MIGRATION: existing highlights and notes were backed up and will be "
            f"preserved while enabling saved AI explanations ({backup_path}).",
            flush=True,
        )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
