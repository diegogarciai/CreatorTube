// Archivo generado por scripts/gen-types.mjs a partir de las migraciones. No editar a mano.
// Regenerar con: pnpm --filter @planificador/db gen:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          id: number;
          workspace_id: string;
          channel_id: string | null;
          episode_id: string | null;
          actor_id: string | null;
          action: string;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          workspace_id: string;
          channel_id?: string | null;
          episode_id?: string | null;
          actor_id?: string | null;
          action: string;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          workspace_id?: string;
          channel_id?: string | null;
          episode_id?: string | null;
          actor_id?: string | null;
          action?: string;
          details?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_models: {
        Row: {
          id: string;
          display_name: string;
          created_at_api: string | null;
          input_price_usd: number | null;
          output_price_usd: number | null;
          available: boolean;
          fetched_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          created_at_api?: string | null;
          input_price_usd?: number | null;
          output_price_usd?: number | null;
          available?: boolean;
          fetched_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          created_at_api?: string | null;
          input_price_usd?: number | null;
          output_price_usd?: number | null;
          available?: boolean;
          fetched_at?: string;
        };
        Relationships: [];
      };
      aid_renders: {
        Row: {
          id: string;
          visual_aid_id: string;
          episode_id: string;
          channel_id: string;
          workspace_id: string;
          task_id: string | null;
          format: string;
          status: string;
          path: string | null;
          bytes: number | null;
          duration_s: number | null;
          error: string | null;
          created_at: string;
          updated_at: string;
          render_version: number;
        };
        Insert: {
          id?: string;
          visual_aid_id: string;
          episode_id: string;
          channel_id: string;
          workspace_id?: string;
          task_id?: string | null;
          format: string;
          status?: string;
          path?: string | null;
          bytes?: number | null;
          duration_s?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          render_version?: number;
        };
        Update: {
          id?: string;
          visual_aid_id?: string;
          episode_id?: string;
          channel_id?: string;
          workspace_id?: string;
          task_id?: string | null;
          format?: string;
          status?: string;
          path?: string | null;
          bytes?: number | null;
          duration_s?: number | null;
          error?: string | null;
          created_at?: string;
          updated_at?: string;
          render_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "aid_renders_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aid_renders_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aid_renders_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aid_renders_visual_aid_id_fkey";
            columns: ["visual_aid_id"];
            isOneToOne: false;
            referencedRelation: "visual_aids";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aid_renders_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_kits: {
        Row: {
          channel_id: string;
          workspace_id: string;
          colors: Json;
          fonts: Json;
          logo_path: string | null;
          thumbnail_style: string | null;
          updated_at: string;
          style: Json;
        };
        Insert: {
          channel_id: string;
          workspace_id?: string;
          colors?: Json;
          fonts?: Json;
          logo_path?: string | null;
          thumbnail_style?: string | null;
          updated_at?: string;
          style?: Json;
        };
        Update: {
          channel_id?: string;
          workspace_id?: string;
          colors?: Json;
          fonts?: Json;
          logo_path?: string | null;
          thumbnail_style?: string | null;
          updated_at?: string;
          style?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "brand_kits_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_kits_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_connections: {
        Row: {
          channel_id: string;
          workspace_id: string;
          provider: string;
          google_subject: string | null;
          access_token_enc: string | null;
          refresh_token_enc: string | null;
          token_expires_at: string | null;
          scopes: string[];
          status: Database["public"]["Enums"]["connection_status"];
          last_verified_at: string | null;
          last_synced_at: string | null;
          last_error: string | null;
          quota_day: string | null;
          quota_used: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          workspace_id?: string;
          provider?: string;
          google_subject?: string | null;
          access_token_enc?: string | null;
          refresh_token_enc?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          status?: Database["public"]["Enums"]["connection_status"];
          last_verified_at?: string | null;
          last_synced_at?: string | null;
          last_error?: string | null;
          quota_day?: string | null;
          quota_used?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          workspace_id?: string;
          provider?: string;
          google_subject?: string | null;
          access_token_enc?: string | null;
          refresh_token_enc?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          status?: Database["public"]["Enums"]["connection_status"];
          last_verified_at?: string | null;
          last_synced_at?: string | null;
          last_error?: string | null;
          quota_day?: string | null;
          quota_used?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_connections_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_connections_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channels: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          youtube_channel_id: string | null;
          youtube_handle: string | null;
          thumbnail_url: string | null;
          language: string;
          timezone: string;
          code_prefix: string;
          weekly_goal: number;
          publish_weekdays: number[];
          record_weekdays: number[];
          formats: string[];
          profile: Json;
          ics_token: string;
          onboarding_completed_at: string | null;
          disconnected_at: string | null;
          created_at: string;
          updated_at: string;
          speech_wpm: number;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          youtube_channel_id?: string | null;
          youtube_handle?: string | null;
          thumbnail_url?: string | null;
          language?: string;
          timezone?: string;
          code_prefix?: string;
          weekly_goal?: number;
          publish_weekdays?: number[];
          record_weekdays?: number[];
          formats?: string[];
          profile?: Json;
          ics_token?: string;
          onboarding_completed_at?: string | null;
          disconnected_at?: string | null;
          created_at?: string;
          updated_at?: string;
          speech_wpm?: number;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          youtube_channel_id?: string | null;
          youtube_handle?: string | null;
          thumbnail_url?: string | null;
          language?: string;
          timezone?: string;
          code_prefix?: string;
          weekly_goal?: number;
          publish_weekdays?: number[];
          record_weekdays?: number[];
          formats?: string[];
          profile?: Json;
          ics_token?: string;
          onboarding_completed_at?: string | null;
          disconnected_at?: string | null;
          created_at?: string;
          updated_at?: string;
          speech_wpm?: number;
        };
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      checklist_steps: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          label: string;
          phase: Database["public"]["Enums"]["checklist_phase"];
          position: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          label: string;
          phase: Database["public"]["Enums"]["checklist_phase"];
          position?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          label?: string;
          phase?: Database["public"]["Enums"]["checklist_phase"];
          position?: number;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "checklist_steps_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checklist_steps_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      devices: {
        Row: {
          id: string;
          user_id: string;
          platform: string;
          push_token: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          platform: string;
          push_token: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          platform?: string;
          push_token?: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      distribution_settings: {
        Row: {
          channel_id: string;
          workspace_id: string;
          newsletter_name: string | null;
          sender_name: string | null;
          sender_email: string | null;
          socials: Json;
          podcast_name: string | null;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          workspace_id?: string;
          newsletter_name?: string | null;
          sender_name?: string | null;
          sender_email?: string | null;
          socials?: Json;
          podcast_name?: string | null;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          workspace_id?: string;
          newsletter_name?: string | null;
          sender_name?: string | null;
          sender_email?: string | null;
          socials?: Json;
          podcast_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "distribution_settings_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "distribution_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episode_assets: {
        Row: {
          id: string;
          episode_id: string;
          channel_id: string;
          workspace_id: string;
          kind: string;
          design_idx: number;
          status: string;
          source_id: string | null;
          base_path: string | null;
          path: string | null;
          text: Json | null;
          text_side: string | null;
          prompt: string | null;
          note: string | null;
          score: Json | null;
          chosen: boolean;
          model: string | null;
          credits: number;
          error: string | null;
          task_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          text_v: string | null;
          idea_id: string | null;
          scheme: string | null;
          scenario: string | null;
          mirror: boolean;
          layout_warnings: string[];
          no_text: boolean;
          no_person: boolean;
          no_product: boolean;
        };
        Insert: {
          id?: string;
          episode_id: string;
          channel_id: string;
          workspace_id?: string;
          kind?: string;
          design_idx: number;
          status?: string;
          source_id?: string | null;
          base_path?: string | null;
          path?: string | null;
          text?: Json | null;
          text_side?: string | null;
          prompt?: string | null;
          note?: string | null;
          score?: Json | null;
          chosen?: boolean;
          model?: string | null;
          credits?: number;
          error?: string | null;
          task_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          text_v?: string | null;
          idea_id?: string | null;
          scheme?: string | null;
          scenario?: string | null;
          mirror?: boolean;
          layout_warnings?: string[];
          no_text?: boolean;
          no_person?: boolean;
          no_product?: boolean;
        };
        Update: {
          id?: string;
          episode_id?: string;
          channel_id?: string;
          workspace_id?: string;
          kind?: string;
          design_idx?: number;
          status?: string;
          source_id?: string | null;
          base_path?: string | null;
          path?: string | null;
          text?: Json | null;
          text_side?: string | null;
          prompt?: string | null;
          note?: string | null;
          score?: Json | null;
          chosen?: boolean;
          model?: string | null;
          credits?: number;
          error?: string | null;
          task_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          text_v?: string | null;
          idea_id?: string | null;
          scheme?: string | null;
          scenario?: string | null;
          mirror?: boolean;
          layout_warnings?: string[];
          no_text?: boolean;
          no_person?: boolean;
          no_product?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "episode_assets_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: true;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "thumbnail_ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "episode_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_assets_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episode_checklist_items: {
        Row: {
          episode_id: string;
          step_id: string;
          workspace_id: string;
          channel_id: string;
          done_at: string;
          done_by: string | null;
        };
        Insert: {
          episode_id: string;
          step_id: string;
          workspace_id?: string;
          channel_id?: string;
          done_at?: string;
          done_by?: string | null;
        };
        Update: {
          episode_id?: string;
          step_id?: string;
          workspace_id?: string;
          channel_id?: string;
          done_at?: string;
          done_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "episode_checklist_items_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_checklist_items_done_by_fkey";
            columns: ["done_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_checklist_items_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_checklist_items_step_id_fkey";
            columns: ["step_id"];
            isOneToOne: false;
            referencedRelation: "checklist_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_checklist_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episode_direction: {
        Row: {
          episode_id: string;
          workspace_id: string;
          channel_id: string;
          status: Database["public"]["Enums"]["direction_status"];
          reading: string;
          questions: Json;
          answers: Json;
          extra: string;
          guide_version_id: string | null;
          task_id: string | null;
          generated_at: string | null;
          answered_at: string | null;
          answered_by: string | null;
          updated_at: string;
        };
        Insert: {
          episode_id: string;
          workspace_id?: string;
          channel_id: string;
          status?: Database["public"]["Enums"]["direction_status"];
          reading?: string;
          questions?: Json;
          answers?: Json;
          extra?: string;
          guide_version_id?: string | null;
          task_id?: string | null;
          generated_at?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          updated_at?: string;
        };
        Update: {
          episode_id?: string;
          workspace_id?: string;
          channel_id?: string;
          status?: Database["public"]["Enums"]["direction_status"];
          reading?: string;
          questions?: Json;
          answers?: Json;
          extra?: string;
          guide_version_id?: string | null;
          task_id?: string | null;
          generated_at?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "episode_direction_answered_by_fkey";
            columns: ["answered_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_direction_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_direction_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: true;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_direction_guide_version_id_fkey";
            columns: ["guide_version_id"];
            isOneToOne: false;
            referencedRelation: "writer_guide_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_direction_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_direction_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episode_evaluations: {
        Row: {
          id: string;
          episode_id: string;
          workspace_id: string;
          channel_id: string;
          notes: string;
          data: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          episode_id: string;
          workspace_id?: string;
          channel_id?: string;
          notes?: string;
          data?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          episode_id?: string;
          workspace_id?: string;
          channel_id?: string;
          notes?: string;
          data?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "episode_evaluations_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_evaluations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_evaluations_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_evaluations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episode_refs: {
        Row: {
          id: string;
          episode_id: string;
          channel_id: string;
          workspace_id: string;
          path: string;
          label: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          episode_id: string;
          channel_id: string;
          workspace_id?: string;
          path: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          episode_id?: string;
          channel_id?: string;
          workspace_id?: string;
          path?: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "episode_refs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_refs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_refs_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episode_refs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      episodes: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          number: number;
          code: string;
          title: string;
          status: Database["public"]["Enums"]["episode_status"];
          stage: Database["public"]["Enums"]["episode_stage"];
          status_changed_at: string;
          format: string;
          priority: string;
          stance: string;
          keywords: string[];
          notes: string;
          pillar_id: string | null;
          idea_id: string | null;
          publish_date: string | null;
          record_date: string | null;
          youtube_video_id: string | null;
          scheduled_at: string | null;
          published_at: string | null;
          writer_guide_version_id: string | null;
          evaluated_at: string | null;
          archived_at: string | null;
          board_position: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          episode_type: Database["public"]["Enums"]["episode_type"] | null;
          target_minutes: number;
          sponsorship: Database["public"]["Enums"]["sponsorship"] | null;
          own_measurements: string;
          stance_confirmed: boolean;
          current_script_run_id: string | null;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          number?: number;
          code?: string;
          title: string;
          status?: Database["public"]["Enums"]["episode_status"];
          stage?: Database["public"]["Enums"]["episode_stage"];
          status_changed_at?: string;
          format?: string;
          priority?: string;
          stance?: string;
          keywords?: string[];
          notes?: string;
          pillar_id?: string | null;
          idea_id?: string | null;
          publish_date?: string | null;
          record_date?: string | null;
          youtube_video_id?: string | null;
          scheduled_at?: string | null;
          published_at?: string | null;
          writer_guide_version_id?: string | null;
          evaluated_at?: string | null;
          archived_at?: string | null;
          board_position?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          episode_type?: Database["public"]["Enums"]["episode_type"] | null;
          target_minutes?: number;
          sponsorship?: Database["public"]["Enums"]["sponsorship"] | null;
          own_measurements?: string;
          stance_confirmed?: boolean;
          current_script_run_id?: string | null;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          number?: number;
          code?: string;
          title?: string;
          status?: Database["public"]["Enums"]["episode_status"];
          stage?: Database["public"]["Enums"]["episode_stage"];
          status_changed_at?: string;
          format?: string;
          priority?: string;
          stance?: string;
          keywords?: string[];
          notes?: string;
          pillar_id?: string | null;
          idea_id?: string | null;
          publish_date?: string | null;
          record_date?: string | null;
          youtube_video_id?: string | null;
          scheduled_at?: string | null;
          published_at?: string | null;
          writer_guide_version_id?: string | null;
          evaluated_at?: string | null;
          archived_at?: string | null;
          board_position?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          episode_type?: Database["public"]["Enums"]["episode_type"] | null;
          target_minutes?: number;
          sponsorship?: Database["public"]["Enums"]["sponsorship"] | null;
          own_measurements?: string;
          stance_confirmed?: boolean;
          current_script_run_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "episodes_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_current_script_run_id_fkey";
            columns: ["current_script_run_id"];
            isOneToOne: false;
            referencedRelation: "script_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_idea_id_fkey";
            columns: ["idea_id"];
            isOneToOne: false;
            referencedRelation: "ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_pillar_id_fkey";
            columns: ["pillar_id"];
            isOneToOne: false;
            referencedRelation: "pillars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_writer_guide_version_id_fkey";
            columns: ["writer_guide_version_id"];
            isOneToOne: false;
            referencedRelation: "writer_guide_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      ideas: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          title: string;
          notes: string;
          origin: Database["public"]["Enums"]["idea_origin"];
          status: Database["public"]["Enums"]["idea_status"];
          signals: Json;
          reasons: string | null;
          risk: string | null;
          pillar_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          title: string;
          notes?: string;
          origin?: Database["public"]["Enums"]["idea_origin"];
          status?: Database["public"]["Enums"]["idea_status"];
          signals?: Json;
          reasons?: string | null;
          risk?: string | null;
          pillar_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          title?: string;
          notes?: string;
          origin?: Database["public"]["Enums"]["idea_origin"];
          status?: Database["public"]["Enums"]["idea_status"];
          signals?: Json;
          reasons?: string | null;
          risk?: string | null;
          pillar_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ideas_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ideas_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ideas_pillar_id_fkey";
            columns: ["pillar_id"];
            isOneToOne: false;
            referencedRelation: "pillars";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ideas_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          id: string;
          kind: Database["public"]["Enums"]["invitation_kind"];
          workspace_id: string | null;
          email: string;
          role: Database["public"]["Enums"]["workspace_role"];
          channel_ids: string[] | null;
          token_hash: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          kind: Database["public"]["Enums"]["invitation_kind"];
          workspace_id?: string | null;
          email: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          channel_ids?: string[] | null;
          token_hash: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          kind?: Database["public"]["Enums"]["invitation_kind"];
          workspace_id?: string | null;
          email?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          channel_ids?: string[] | null;
          token_hash?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey";
            columns: ["accepted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          channel_ids: string[] | null;
          credit_limit: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          channel_ids?: string[] | null;
          credit_limit?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          channel_ids?: string[] | null;
          credit_limit?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      pillars: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          name: string;
          description: string;
          color: string;
          position: number;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          name: string;
          description?: string;
          color?: string;
          position?: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          name?: string;
          description?: string;
          color?: string;
          position?: number;
          archived_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pillars_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pillars_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          email: string;
          created_at: string;
        };
        Insert: {
          email: string;
          created_at?: string;
        };
        Update: {
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      presenter_photos: {
        Row: {
          id: string;
          channel_id: string;
          workspace_id: string;
          path: string;
          label: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          workspace_id?: string;
          path: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          channel_id?: string;
          workspace_id?: string;
          path?: string;
          label?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "presenter_photos_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "presenter_photos_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "presenter_photos_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          locale: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          locale?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      script_runs: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          episode_id: string;
          guide_version_id: string | null;
          model: string;
          from_stage: Database["public"]["Enums"]["script_stage"];
          status: Database["public"]["Enums"]["stage_run_status"];
          direction_block: string;
          task_id: string | null;
          created_by: string | null;
          created_at: string;
          finished_at: string | null;
          from_step: string | null;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          episode_id: string;
          guide_version_id?: string | null;
          model?: string;
          from_stage?: Database["public"]["Enums"]["script_stage"];
          status?: Database["public"]["Enums"]["stage_run_status"];
          direction_block?: string;
          task_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          finished_at?: string | null;
          from_step?: string | null;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          episode_id?: string;
          guide_version_id?: string | null;
          model?: string;
          from_stage?: Database["public"]["Enums"]["script_stage"];
          status?: Database["public"]["Enums"]["stage_run_status"];
          direction_block?: string;
          task_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          finished_at?: string | null;
          from_step?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "script_runs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_runs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_runs_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_runs_guide_version_id_fkey";
            columns: ["guide_version_id"];
            isOneToOne: false;
            referencedRelation: "writer_guide_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_runs_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      script_stage_runs: {
        Row: {
          id: string;
          run_id: string;
          workspace_id: string;
          channel_id: string;
          stage: Database["public"]["Enums"]["script_stage"];
          status: Database["public"]["Enums"]["stage_run_status"];
          blocks: Json;
          raw: string;
          usage: Json;
          credits: number;
          error: string | null;
          progress_message: string | null;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          workspace_id?: string;
          channel_id: string;
          stage: Database["public"]["Enums"]["script_stage"];
          status?: Database["public"]["Enums"]["stage_run_status"];
          blocks?: Json;
          raw?: string;
          usage?: Json;
          credits?: number;
          error?: string | null;
          progress_message?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          run_id?: string;
          workspace_id?: string;
          channel_id?: string;
          stage?: Database["public"]["Enums"]["script_stage"];
          status?: Database["public"]["Enums"]["stage_run_status"];
          blocks?: Json;
          raw?: string;
          usage?: Json;
          credits?: number;
          error?: string | null;
          progress_message?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "script_stage_runs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_stage_runs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "script_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_stage_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      script_step_runs: {
        Row: {
          id: string;
          run_id: string;
          workspace_id: string;
          channel_id: string;
          stage: Database["public"]["Enums"]["script_stage"];
          step: string;
          status: Database["public"]["Enums"]["stage_run_status"];
          body: string;
          raw: string;
          usage: Json;
          credits: number;
          error: string | null;
          progress_message: string | null;
          preview: string | null;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          workspace_id?: string;
          channel_id: string;
          stage: Database["public"]["Enums"]["script_stage"];
          step: string;
          status?: Database["public"]["Enums"]["stage_run_status"];
          body?: string;
          raw?: string;
          usage?: Json;
          credits?: number;
          error?: string | null;
          progress_message?: string | null;
          preview?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          run_id?: string;
          workspace_id?: string;
          channel_id?: string;
          stage?: Database["public"]["Enums"]["script_stage"];
          step?: string;
          status?: Database["public"]["Enums"]["stage_run_status"];
          body?: string;
          raw?: string;
          usage?: Json;
          credits?: number;
          error?: string | null;
          progress_message?: string | null;
          preview?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "script_step_runs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_step_runs_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "script_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_step_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      service_budgets: {
        Row: {
          service: string;
          monthly_usd: number;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          service: string;
          monthly_usd: number;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          service?: string;
          monthly_usd?: number;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_budgets_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string | null;
          episode_id: string | null;
          kind: string;
          status: Database["public"]["Enums"]["task_status"];
          progress: number;
          message: string | null;
          credits_estimated: number | null;
          credits_used: number | null;
          external_run_id: string | null;
          error: string | null;
          requested_by: string | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          channel_id?: string | null;
          episode_id?: string | null;
          kind: string;
          status?: Database["public"]["Enums"]["task_status"];
          progress?: number;
          message?: string | null;
          credits_estimated?: number | null;
          credits_used?: number | null;
          external_run_id?: string | null;
          error?: string | null;
          requested_by?: string | null;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string | null;
          episode_id?: string | null;
          kind?: string;
          status?: Database["public"]["Enums"]["task_status"];
          progress?: number;
          message?: string | null;
          credits_estimated?: number | null;
          credits_used?: number | null;
          external_run_id?: string | null;
          error?: string | null;
          requested_by?: string | null;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      thumbnail_ideas: {
        Row: {
          id: string;
          episode_id: string;
          channel_id: string;
          workspace_id: string;
          task_id: string | null;
          position: number;
          angle: string;
          text: string;
          accent: string;
          scene: string;
          emotion: string;
          slot: number | null;
          created_at: string;
          scheme: string;
          title: string;
        };
        Insert: {
          id?: string;
          episode_id: string;
          channel_id: string;
          workspace_id?: string;
          task_id?: string | null;
          position?: number;
          angle: string;
          text: string;
          accent?: string;
          scene?: string;
          emotion?: string;
          slot?: number | null;
          created_at?: string;
          scheme: string;
          title?: string;
        };
        Update: {
          id?: string;
          episode_id?: string;
          channel_id?: string;
          workspace_id?: string;
          task_id?: string | null;
          position?: number;
          angle?: string;
          text?: string;
          accent?: string;
          scene?: string;
          emotion?: string;
          slot?: number | null;
          created_at?: string;
          scheme?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thumbnail_ideas_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thumbnail_ideas_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thumbnail_ideas_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thumbnail_ideas_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_ledger: {
        Row: {
          id: number;
          workspace_id: string;
          channel_id: string | null;
          task_id: string | null;
          user_id: string | null;
          kind: string;
          credits: number;
          cost_usd: number;
          meta: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          workspace_id: string;
          channel_id?: string | null;
          task_id?: string | null;
          user_id?: string | null;
          kind: string;
          credits?: number;
          cost_usd?: number;
          meta?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          workspace_id?: string;
          channel_id?: string | null;
          task_id?: string | null;
          user_id?: string | null;
          kind?: string;
          credits?: number;
          cost_usd?: number;
          meta?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_ledger_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_ledger_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_ledger_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_ledger_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      verification_items: {
        Row: {
          id: string;
          run_id: string;
          workspace_id: string;
          channel_id: string;
          idx: number;
          kind: string;
          claim: string;
          line: string;
          occurrences: number;
          status: string;
          nature: string | null;
          url: string | null;
          source_title: string | null;
          quote: string | null;
          data_date: string | null;
          value: string | null;
          note: string;
          updated_at: string;
          decision: string | null;
          decision_value: string | null;
          decided_by: string | null;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          run_id: string;
          workspace_id?: string;
          channel_id: string;
          idx: number;
          kind: string;
          claim: string;
          line?: string;
          occurrences?: number;
          status?: string;
          nature?: string | null;
          url?: string | null;
          source_title?: string | null;
          quote?: string | null;
          data_date?: string | null;
          value?: string | null;
          note?: string;
          updated_at?: string;
          decision?: string | null;
          decision_value?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
        };
        Update: {
          id?: string;
          run_id?: string;
          workspace_id?: string;
          channel_id?: string;
          idx?: number;
          kind?: string;
          claim?: string;
          line?: string;
          occurrences?: number;
          status?: string;
          nature?: string | null;
          url?: string | null;
          source_title?: string | null;
          quote?: string | null;
          data_date?: string | null;
          value?: string | null;
          note?: string;
          updated_at?: string;
          decision?: string | null;
          decision_value?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "verification_items_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verification_items_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verification_items_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "script_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verification_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      visual_aids: {
        Row: {
          id: string;
          episode_id: string;
          channel_id: string;
          workspace_id: string;
          task_id: string | null;
          script_run_id: string | null;
          kind: string;
          code: string;
          position: number;
          paragraph: number;
          anchor: string;
          idea: string | null;
          title: string;
          definition: string | null;
          elements: Json;
          claim_rows: number[];
          footer: string | null;
          duration_s: number | null;
          piece: string | null;
          scores: Json | null;
          vertical: boolean;
          status: string;
          edited: boolean;
          created_at: string;
          updated_at: string;
          segment: string | null;
          aid_case: string | null;
          beats: Json;
        };
        Insert: {
          id?: string;
          episode_id: string;
          channel_id: string;
          workspace_id?: string;
          task_id?: string | null;
          script_run_id?: string | null;
          kind: string;
          code: string;
          position?: number;
          paragraph?: number;
          anchor: string;
          idea?: string | null;
          title: string;
          definition?: string | null;
          elements?: Json;
          claim_rows?: number[];
          footer?: string | null;
          duration_s?: number | null;
          piece?: string | null;
          scores?: Json | null;
          vertical?: boolean;
          status?: string;
          edited?: boolean;
          created_at?: string;
          updated_at?: string;
          segment?: string | null;
          aid_case?: string | null;
          beats?: Json;
        };
        Update: {
          id?: string;
          episode_id?: string;
          channel_id?: string;
          workspace_id?: string;
          task_id?: string | null;
          script_run_id?: string | null;
          kind?: string;
          code?: string;
          position?: number;
          paragraph?: number;
          anchor?: string;
          idea?: string | null;
          title?: string;
          definition?: string | null;
          elements?: Json;
          claim_rows?: number[];
          footer?: string | null;
          duration_s?: number | null;
          piece?: string | null;
          scores?: Json | null;
          vertical?: boolean;
          status?: string;
          edited?: boolean;
          created_at?: string;
          updated_at?: string;
          segment?: string | null;
          aid_case?: string | null;
          beats?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "visual_aids_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visual_aids_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visual_aids_script_run_id_fkey";
            columns: ["script_run_id"];
            isOneToOne: false;
            referencedRelation: "script_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visual_aids_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visual_aids_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_ai_settings: {
        Row: {
          workspace_id: string;
          default_model: string | null;
          stage_models: Json;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          default_model?: string | null;
          stage_models?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          workspace_id?: string;
          default_model?: string | null;
          stage_models?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_ai_settings_default_model_fkey";
            columns: ["default_model"];
            isOneToOne: false;
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_ai_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_ai_settings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          monthly_credit_limit: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          monthly_credits: number;
        };
        Insert: {
          id?: string;
          name: string;
          monthly_credit_limit?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          monthly_credits?: number;
        };
        Update: {
          id?: string;
          name?: string;
          monthly_credit_limit?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          monthly_credits?: number;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      writer_guide_versions: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          guide_id: string;
          version: number;
          content: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          sections: Json;
          stage_sections: Json;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          guide_id: string;
          version: number;
          content: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          sections?: Json;
          stage_sections?: Json;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          guide_id?: string;
          version?: number;
          content?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          sections?: Json;
          stage_sections?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "writer_guide_versions_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writer_guide_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writer_guide_versions_guide_id_fkey";
            columns: ["guide_id"];
            isOneToOne: false;
            referencedRelation: "writer_guides";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writer_guide_versions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      writer_guides: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          current_version_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id?: string;
          channel_id: string;
          current_version_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          channel_id?: string;
          current_version_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "writer_guides_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writer_guides_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "writer_guide_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writer_guides_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_channel_daily_stats: {
        Row: {
          channel_id: string;
          day: string;
          workspace_id: string;
          views: number;
          watch_minutes: number;
          average_view_duration_seconds: number;
          average_view_percentage: number;
          subscribers_gained: number;
          subscribers_lost: number;
          likes: number;
          comments: number;
          shares: number;
          fetched_at: string;
        };
        Insert: {
          channel_id: string;
          day: string;
          workspace_id?: string;
          views?: number;
          watch_minutes?: number;
          average_view_duration_seconds?: number;
          average_view_percentage?: number;
          subscribers_gained?: number;
          subscribers_lost?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          fetched_at?: string;
        };
        Update: {
          channel_id?: string;
          day?: string;
          workspace_id?: string;
          views?: number;
          watch_minutes?: number;
          average_view_duration_seconds?: number;
          average_view_percentage?: number;
          subscribers_gained?: number;
          subscribers_lost?: number;
          likes?: number;
          comments?: number;
          shares?: number;
          fetched_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_channel_daily_stats_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_channel_daily_stats_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_import_items: {
        Row: {
          task_id: string;
          workspace_id: string;
          channel_id: string;
          episode_id: string;
          video_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          task_id: string;
          workspace_id?: string;
          channel_id: string;
          episode_id: string;
          video_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          task_id?: string;
          workspace_id?: string;
          channel_id?: string;
          episode_id?: string;
          video_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_import_items_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_import_items_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_import_items_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_import_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_video_daily_stats: {
        Row: {
          channel_id: string;
          video_id: string;
          day: string;
          workspace_id: string;
          views: number | null;
          watch_minutes: number | null;
          average_view_duration_seconds: number | null;
          likes: number | null;
          comments: number | null;
          subscribers_gained: number | null;
          fetched_at: string;
          average_view_percentage: number | null;
          subscribers_lost: number | null;
          shares: number | null;
        };
        Insert: {
          channel_id: string;
          video_id: string;
          day: string;
          workspace_id?: string;
          views?: number | null;
          watch_minutes?: number | null;
          average_view_duration_seconds?: number | null;
          likes?: number | null;
          comments?: number | null;
          subscribers_gained?: number | null;
          fetched_at?: string;
          average_view_percentage?: number | null;
          subscribers_lost?: number | null;
          shares?: number | null;
        };
        Update: {
          channel_id?: string;
          video_id?: string;
          day?: string;
          workspace_id?: string;
          views?: number | null;
          watch_minutes?: number | null;
          average_view_duration_seconds?: number | null;
          likes?: number | null;
          comments?: number | null;
          subscribers_gained?: number | null;
          fetched_at?: string;
          average_view_percentage?: number | null;
          subscribers_lost?: number | null;
          shares?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_video_daily_stats_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_video_daily_stats_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_video_retention: {
        Row: {
          channel_id: string;
          video_id: string;
          workspace_id: string;
          points: Json;
          fetched_at: string;
        };
        Insert: {
          channel_id: string;
          video_id: string;
          workspace_id?: string;
          points?: Json;
          fetched_at?: string;
        };
        Update: {
          channel_id?: string;
          video_id?: string;
          workspace_id?: string;
          points?: Json;
          fetched_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_video_retention_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_video_retention_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_video_snapshots: {
        Row: {
          channel_id: string;
          video_id: string;
          day: string;
          workspace_id: string;
          view_count: number | null;
          like_count: number | null;
          comment_count: number | null;
          taken_at: string;
        };
        Insert: {
          channel_id: string;
          video_id: string;
          day: string;
          workspace_id?: string;
          view_count?: number | null;
          like_count?: number | null;
          comment_count?: number | null;
          taken_at?: string;
        };
        Update: {
          channel_id?: string;
          video_id?: string;
          day?: string;
          workspace_id?: string;
          view_count?: number | null;
          like_count?: number | null;
          comment_count?: number | null;
          taken_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_video_snapshots_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_video_snapshots_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      youtube_videos: {
        Row: {
          channel_id: string;
          video_id: string;
          workspace_id: string;
          title: string | null;
          description: string | null;
          thumbnail_url: string | null;
          privacy_status: string | null;
          publish_at: string | null;
          published_at: string | null;
          duration_seconds: number | null;
          view_count: number | null;
          like_count: number | null;
          comment_count: number | null;
          fetched_at: string;
          tags: string[] | null;
        };
        Insert: {
          channel_id: string;
          video_id: string;
          workspace_id?: string;
          title?: string | null;
          description?: string | null;
          thumbnail_url?: string | null;
          privacy_status?: string | null;
          publish_at?: string | null;
          published_at?: string | null;
          duration_seconds?: number | null;
          view_count?: number | null;
          like_count?: number | null;
          comment_count?: number | null;
          fetched_at?: string;
          tags?: string[] | null;
        };
        Update: {
          channel_id?: string;
          video_id?: string;
          workspace_id?: string;
          title?: string | null;
          description?: string | null;
          thumbnail_url?: string | null;
          privacy_status?: string | null;
          publish_at?: string | null;
          published_at?: string | null;
          duration_seconds?: number | null;
          view_count?: number | null;
          like_count?: number | null;
          comment_count?: number | null;
          fetched_at?: string;
          tags?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "youtube_videos_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "youtube_videos_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_invitation: {
        Args: { token: string; workspace_name?: string };
        Returns: string;
      };
      accept_invitation_by_id: {
        Args: { invitation: string; workspace_name?: string };
        Returns: string;
      };
      accept_invitation_row: {
        Args: { inv_id: string; workspace_name: string };
        Returns: string;
      };
      channel_connection_info: {
        Args: { ch: string };
        Returns: {
          status: Database["public"]["Enums"]["connection_status"];
          scopes: string[];
          last_verified_at: string;
          last_synced_at: string;
          last_error: string;
        }[];
      };
      create_workspace: {
        Args: { workspace_name: string };
        Returns: string;
      };
      create_workspace_for: {
        Args: { owner: string; workspace_name: string };
        Returns: string;
      };
      has_channel_permission: {
        Args: { ch: string; perm: string };
        Returns: boolean;
      };
      has_channel_permission_in: {
        Args: { ws: string; ch: string; perm: string };
        Returns: boolean;
      };
      has_workspace_permission: {
        Args: { ws: string; perm: string };
        Returns: boolean;
      };
      hash_invitation_token: {
        Args: { token: string };
        Returns: string;
      };
      hook_before_user_created: {
        Args: { event: Json };
        Returns: Json;
      };
      invitation_preview: {
        Args: { token: string };
        Returns: {
          kind: Database["public"]["Enums"]["invitation_kind"];
          workspace_name: string;
          role: Database["public"]["Enums"]["workspace_role"];
          email_hint: string;
          expired: boolean;
          accepted: boolean;
        }[];
      };
      is_platform_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_workspace_member: {
        Args: { ws: string };
        Returns: boolean;
      };
      media_path_channel: {
        Args: { path: string };
        Returns: string;
      };
      my_pending_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          kind: Database["public"]["Enums"]["invitation_kind"];
          workspace_name: string;
          role: Database["public"]["Enums"]["workspace_role"];
          expires_at: string;
        }[];
      };
      publish_writer_guide_version: {
        Args: { ch: string; content: string; notes: string; sections: Json; stage_sections: Json };
        Returns: string;
      };
      purge_youtube_data: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      regenerate_ics_token: {
        Args: { ch: string };
        Returns: string;
      };
      role_has_permission: {
        Args: { r: Database["public"]["Enums"]["workspace_role"]; perm: string };
        Returns: boolean;
      };
      shares_workspace_with: {
        Args: { other: string };
        Returns: boolean;
      };
      usage_breakdown: {
        Args: { since: string; until: string };
        Returns: {
          workspace_id: string;
          kind: string;
          model: string;
          calls: number;
          credits: number;
          cost_usd: number;
          input_tokens: number;
          output_tokens: number;
          cache_tokens: number;
          searches: number;
          search_usd: number;
          legacy_searches: number;
          images: number;
          image_usd: number;
        }[];
      };
      usage_monthly: {
        Args: { months: number };
        Returns: {
          month: string;
          calls: number;
          cost_usd: number;
          searches: number;
          search_usd: number;
          legacy_searches: number;
          image_usd: number;
        }[];
      };
      workspace_credits: {
        Args: { ws: string };
        Returns: { monthly: number; used: number; remaining: number }[];
      };
    };
    Enums: {
      checklist_phase: "before_publish" | "after_publish";
      connection_status: "active" | "needs_reauth" | "revoked";
      direction_status: "generating" | "ready" | "answered" | "skipped";
      episode_stage:
        | "planning"
        | "direction"
        | "script"
        | "verification"
        | "preparation"
        | "recording"
        | "publication"
        | "distribution"
        | "evaluation";
      episode_status: "planned" | "script" | "to_record" | "editing" | "scheduled" | "published";
      episode_type: "product" | "explainer" | "news" | "opinion";
      idea_origin: "recommendation" | "own" | "pain_point";
      idea_status: "new" | "in_progress" | "discarded";
      invitation_kind: "platform" | "workspace";
      script_stage: "study" | "script" | "verification" | "publication" | "podcast";
      sponsorship: "none" | "sponsor" | "affiliate";
      stage_run_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "incomplete"
        | "skipped"
        | "paused";
      task_status: "queued" | "running" | "succeeded" | "failed" | "canceled";
      workspace_role: "owner" | "admin" | "producer" | "writer" | "video_editor" | "viewer";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
