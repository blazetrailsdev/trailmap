// Solid Queue's schema, as `bin/rails solid_queue:install` writes it to
// db/queue_schema.rb (solid_queue v1.1.3, lib/generators/solid_queue/install/
// templates/db/queue_schema.rb). trails has not ported the install generator
// (story `port-solid-queue-tasks`), so this is transcribed from that template —
// the same transcription trails' own suite loads (packages/solid-queue/src/
// test-helpers/queue-schema.ts). `trails db prepare` loads it into an empty
// `queue` database; see config/database.ts.

import { Schema } from "@blazetrails/activerecord";

await Schema.get(7.1).define({ version: 1 }, async (ctx) => {
  await ctx.createTable("solid_queue_blocked_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.string("queue_name", { null: false });
    t.integer("priority", { default: 0, null: false });
    t.string("concurrency_key", { null: false });
    t.datetime("expires_at", { null: false });
    t.datetime("created_at", { null: false });
    t.index(["concurrency_key", "priority", "job_id"], {
      name: "index_solid_queue_blocked_executions_for_release",
    });
    t.index(["expires_at", "concurrency_key"], {
      name: "index_solid_queue_blocked_executions_for_maintenance",
    });
    t.index(["job_id"], {
      name: "index_solid_queue_blocked_executions_on_job_id",
      unique: true,
    });
  });

  await ctx.createTable("solid_queue_claimed_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.bigint("process_id");
    t.datetime("created_at", { null: false });
    t.index(["job_id"], {
      name: "index_solid_queue_claimed_executions_on_job_id",
      unique: true,
    });
    t.index(["process_id", "job_id"], {
      name: "index_solid_queue_claimed_executions_on_process_id_and_job_id",
    });
  });

  await ctx.createTable("solid_queue_failed_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.text("error");
    t.datetime("created_at", { null: false });
    t.index(["job_id"], {
      name: "index_solid_queue_failed_executions_on_job_id",
      unique: true,
    });
  });

  await ctx.createTable("solid_queue_jobs", { force: "cascade" }, (t) => {
    t.string("queue_name", { null: false });
    t.string("class_name", { null: false });
    t.text("arguments");
    t.integer("priority", { default: 0, null: false });
    t.string("active_job_id");
    t.datetime("scheduled_at");
    t.datetime("finished_at");
    t.string("concurrency_key");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["active_job_id"], {
      name: "index_solid_queue_jobs_on_active_job_id",
    });
    t.index(["class_name"], { name: "index_solid_queue_jobs_on_class_name" });
    t.index(["finished_at"], { name: "index_solid_queue_jobs_on_finished_at" });
    t.index(["queue_name", "finished_at"], {
      name: "index_solid_queue_jobs_for_filtering",
    });
    t.index(["scheduled_at", "finished_at"], {
      name: "index_solid_queue_jobs_for_alerting",
    });
  });

  await ctx.createTable("solid_queue_pauses", { force: "cascade" }, (t) => {
    t.string("queue_name", { null: false });
    t.datetime("created_at", { null: false });
    t.index(["queue_name"], {
      name: "index_solid_queue_pauses_on_queue_name",
      unique: true,
    });
  });

  await ctx.createTable("solid_queue_processes", { force: "cascade" }, (t) => {
    t.string("kind", { null: false });
    t.datetime("last_heartbeat_at", { null: false });
    t.bigint("supervisor_id");
    t.integer("pid", { null: false });
    t.string("hostname");
    t.text("metadata");
    t.datetime("created_at", { null: false });
    t.string("name", { null: false });
    t.index(["last_heartbeat_at"], {
      name: "index_solid_queue_processes_on_last_heartbeat_at",
    });
    t.index(["name", "supervisor_id"], {
      name: "index_solid_queue_processes_on_name_and_supervisor_id",
      unique: true,
    });
    t.index(["supervisor_id"], {
      name: "index_solid_queue_processes_on_supervisor_id",
    });
  });

  await ctx.createTable("solid_queue_ready_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.string("queue_name", { null: false });
    t.integer("priority", { default: 0, null: false });
    t.datetime("created_at", { null: false });
    t.index(["job_id"], {
      name: "index_solid_queue_ready_executions_on_job_id",
      unique: true,
    });
    t.index(["priority", "job_id"], { name: "index_solid_queue_poll_all" });
    t.index(["queue_name", "priority", "job_id"], {
      name: "index_solid_queue_poll_by_queue",
    });
  });

  await ctx.createTable("solid_queue_recurring_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.string("task_key", { null: false });
    t.datetime("run_at", { null: false });
    t.datetime("created_at", { null: false });
    t.index(["job_id"], {
      name: "index_solid_queue_recurring_executions_on_job_id",
      unique: true,
    });
    t.index(["task_key", "run_at"], {
      name: "index_solid_queue_recurring_executions_on_task_key_and_run_at",
      unique: true,
    });
  });

  await ctx.createTable("solid_queue_recurring_tasks", { force: "cascade" }, (t) => {
    t.string("key", { null: false });
    t.string("schedule", { null: false });
    t.string("command", { limit: 2048 });
    t.string("class_name");
    t.text("arguments");
    t.string("queue_name");
    t.integer("priority", { default: 0 });
    t.boolean("static", { default: true, null: false });
    t.text("description");
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["key"], {
      name: "index_solid_queue_recurring_tasks_on_key",
      unique: true,
    });
    t.index(["static"], {
      name: "index_solid_queue_recurring_tasks_on_static",
    });
  });

  await ctx.createTable("solid_queue_scheduled_executions", { force: "cascade" }, (t) => {
    t.bigint("job_id", { null: false });
    t.string("queue_name", { null: false });
    t.integer("priority", { default: 0, null: false });
    t.datetime("scheduled_at", { null: false });
    t.datetime("created_at", { null: false });
    t.index(["job_id"], {
      name: "index_solid_queue_scheduled_executions_on_job_id",
      unique: true,
    });
    t.index(["scheduled_at", "priority", "job_id"], {
      name: "index_solid_queue_dispatch_all",
    });
  });

  await ctx.createTable("solid_queue_semaphores", { force: "cascade" }, (t) => {
    t.string("key", { null: false });
    t.integer("value", { default: 1, null: false });
    t.datetime("expires_at", { null: false });
    t.datetime("created_at", { null: false });
    t.datetime("updated_at", { null: false });
    t.index(["expires_at"], {
      name: "index_solid_queue_semaphores_on_expires_at",
    });
    t.index(["key", "value"], {
      name: "index_solid_queue_semaphores_on_key_and_value",
    });
    t.index(["key"], {
      name: "index_solid_queue_semaphores_on_key",
      unique: true,
    });
  });

  await ctx.addForeignKey("solid_queue_blocked_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
  await ctx.addForeignKey("solid_queue_claimed_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
  await ctx.addForeignKey("solid_queue_failed_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
  await ctx.addForeignKey("solid_queue_ready_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
  await ctx.addForeignKey("solid_queue_recurring_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
  await ctx.addForeignKey("solid_queue_scheduled_executions", "solid_queue_jobs", {
    column: "job_id",
    onDelete: "cascade",
  });
});
