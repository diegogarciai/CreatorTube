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
      brand_kits: {
        Row: {
          channel_id: string;
          workspace_id: string;
          colors: Json;
          fonts: Json;
          logo_path: string | null;
          thumbnail_style: string | null;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          workspace_id?: string;
          colors?: Json;
          fonts?: Json;
          logo_path?: string | null;
          thumbnail_style?: string | null;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          workspace_id?: string;
          colors?: Json;
          fonts?: Json;
          logo_path?: string | null;
          thumbnail_style?: string | null;
          updated_at?: string;
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
        Relationships: [
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
        Relationships: [
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
      workspaces: {
        Row: {
          id: string;
          name: string;
          monthly_credit_limit: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          monthly_credit_limit?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          monthly_credit_limit?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
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
      channel_connection_info: {
        Args: { ch: string };
        Returns: { status: Database["public"]["Enums"]["connection_status"]; scopes: string[]; last_verified_at: string; last_synced_at: string; last_error: string }[];
      };
      create_workspace: {
        Args: { workspace_name: string };
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
      invitation_preview: {
        Args: { token: string };
        Returns: { kind: Database["public"]["Enums"]["invitation_kind"]; workspace_name: string; role: Database["public"]["Enums"]["workspace_role"]; email_hint: string; expired: boolean; accepted: boolean }[];
      };
      is_platform_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_workspace_member: {
        Args: { ws: string };
        Returns: boolean;
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
    };
    Enums: {
      checklist_phase: "before_publish" | "after_publish";
      connection_status: "active" | "needs_reauth" | "revoked";
      episode_stage: "planning" | "direction" | "script" | "verification" | "preparation" | "recording" | "publication" | "distribution" | "evaluation";
      episode_status: "planned" | "script" | "to_record" | "editing" | "scheduled" | "published";
      idea_origin: "recommendation" | "own" | "pain_point";
      idea_status: "new" | "in_progress" | "discarded";
      invitation_kind: "platform" | "workspace";
      task_status: "queued" | "running" | "succeeded" | "failed" | "canceled";
      workspace_role: "owner" | "admin" | "producer" | "writer" | "video_editor" | "viewer";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
