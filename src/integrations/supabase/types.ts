export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_rate_limits: {
        Row: {
          bucket_key: string
          hits: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          hits?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          hits?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      crm_field_defs: {
        Row: {
          created_at: string
          crm_key: string
          field_key: string
          field_type: string
          id: string
          label: string
          options: Json
          required: boolean
          show_in_table: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          crm_key: string
          field_key: string
          field_type?: string
          id?: string
          label: string
          options?: Json
          required?: boolean
          show_in_table?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          crm_key?: string
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          options?: Json
          required?: boolean
          show_in_table?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_field_defs_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
        ]
      }
      crm_record_activity: {
        Row: {
          action: string
          actor_display_name: string | null
          actor_id: string | null
          created_at: string
          crm_key: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          record_id: string | null
        }
        Insert: {
          action: string
          actor_display_name?: string | null
          actor_id?: string | null
          created_at?: string
          crm_key: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id?: string | null
        }
        Update: {
          action?: string
          actor_display_name?: string | null
          actor_id?: string | null
          created_at?: string
          crm_key?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_record_activity_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "crm_record_activity_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "crm_records"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_record_notes: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          created_at: string
          crm_key: string
          id: string
          record_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          created_at?: string
          crm_key: string
          id?: string
          record_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          created_at?: string
          crm_key?: string
          id?: string
          record_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_record_notes_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "crm_record_notes_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "crm_records"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_records: {
        Row: {
          assigned_agent_id: string | null
          caller_phone: string | null
          created_at: string
          created_by: string | null
          crm_key: string
          custom: Json
          email: string | null
          id: string
          name: string
          notes: string | null
          parent_record_id: string | null
          phone: string | null
          record_code: string
          reminder_at: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          caller_phone?: string | null
          created_at?: string
          created_by?: string | null
          crm_key: string
          custom?: Json
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          parent_record_id?: string | null
          phone?: string | null
          record_code: string
          reminder_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          caller_phone?: string | null
          created_at?: string
          created_by?: string | null
          crm_key?: string
          custom?: Json
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          parent_record_id?: string | null
          phone?: string | null
          record_code?: string
          reminder_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_records_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "crm_records_parent_record_id_fkey"
            columns: ["parent_record_id"]
            isOneToOne: false
            referencedRelation: "crm_records"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_settings: {
        Row: {
          crm_key: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          crm_key: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          crm_key?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_settings_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
        ]
      }
      crm_user_roles: {
        Row: {
          created_at: string
          crm_key: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          crm_key: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          crm_key?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_user_roles_crm_key_fkey"
            columns: ["crm_key"]
            isOneToOne: false
            referencedRelation: "crms"
            referencedColumns: ["key"]
          },
        ]
      }
      crms: {
        Row: {
          color: string
          created_at: string
          icon: string | null
          id_label: string
          is_active: boolean
          key: string
          name: string
          record_table: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string | null
          id_label?: string
          is_active?: boolean
          key: string
          name: string
          record_table: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string | null
          id_label?: string
          is_active?: boolean
          key?: string
          name?: string
          record_table?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_saved_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_messages: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          body: string
          created_at: string
          crm_key: string | null
          crm_record_id: string | null
          direction: string
          from_address: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          in_reply_to: string | null
          read_at: string | null
          subject: string | null
          system_id: string | null
          to_address: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          body?: string
          created_at?: string
          crm_key?: string | null
          crm_record_id?: string | null
          direction: string
          from_address?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          in_reply_to?: string | null
          read_at?: string | null
          subject?: string | null
          system_id?: string | null
          to_address?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          body?: string
          created_at?: string
          crm_key?: string | null
          crm_record_id?: string | null
          direction?: string
          from_address?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          in_reply_to?: string | null
          read_at?: string | null
          subject?: string | null
          system_id?: string | null
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_crm_record_id_fkey"
            columns: ["crm_record_id"]
            isOneToOne: false
            referencedRelation: "crm_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_threads: {
        Row: {
          created_at: string
          crm_record_id: string | null
          gmail_thread_id: string
          system_id: string | null
        }
        Insert: {
          created_at?: string
          crm_record_id?: string | null
          gmail_thread_id: string
          system_id?: string | null
        }
        Update: {
          created_at?: string
          crm_record_id?: string | null
          gmail_thread_id?: string
          system_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_crm_record_id_fkey"
            columns: ["crm_record_id"]
            isOneToOne: false
            referencedRelation: "crm_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      kosher_instructions: {
        Row: {
          body: string
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: []
      }
      notification_role_defaults: {
        Row: {
          enabled: boolean
          event_key: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          event_key: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          event_key?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notification_user_overrides: {
        Row: {
          enabled: boolean
          event_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled: boolean
          event_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          event_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          email_display_name: string | null
          email_signature: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email_display_name?: string | null
          email_signature?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email_display_name?: string | null
          email_signature?: string | null
          id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          crm_key: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed?: boolean
          crm_key?: string
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed?: boolean
          crm_key?: string
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      status_settings: {
        Row: {
          assigned_agent_ids: string[]
          is_custom: boolean
          is_handled: boolean
          is_mandatory: boolean
          label: string
          sort_order: number
          status_key: string
          tone: string
          updated_at: string
        }
        Insert: {
          assigned_agent_ids?: string[]
          is_custom?: boolean
          is_handled?: boolean
          is_mandatory?: boolean
          label: string
          sort_order?: number
          status_key: string
          tone: string
          updated_at?: string
        }
        Update: {
          assigned_agent_ids?: string[]
          is_custom?: boolean
          is_handled?: boolean
          is_mandatory?: boolean
          label?: string
          sort_order?: number
          status_key?: string
          tone?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_activity_log: {
        Row: {
          action: string
          actor_display_name: string | null
          actor_id: string | null
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          reason: string | null
          system_id: string | null
        }
        Insert: {
          action: string
          actor_display_name?: string | null
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          system_id?: string | null
        }
        Update: {
          action?: string
          actor_display_name?: string | null
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          reason?: string | null
          system_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_activity_log_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      system_files: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number
          storage_path: string
          system_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number
          storage_path: string
          system_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number
          storage_path?: string
          system_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_files_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      system_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          system_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          system_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          system_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_notes_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      system_transfers: {
        Row: {
          created_at: string
          from_agent_id: string | null
          id: string
          reason: string | null
          system_id: string
          to_agent_id: string | null
          transferred_by: string | null
        }
        Insert: {
          created_at?: string
          from_agent_id?: string | null
          id?: string
          reason?: string | null
          system_id: string
          to_agent_id?: string | null
          transferred_by?: string | null
        }
        Update: {
          created_at?: string
          from_agent_id?: string | null
          id?: string
          reason?: string | null
          system_id?: string
          to_agent_id?: string | null
          transferred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_transfers_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      systems: {
        Row: {
          additional_caller_phones: Json
          additional_emails: Json
          assigned_agent_id: string | null
          audio_url: string | null
          caller_phone: string | null
          created_at: string
          email: string | null
          handled_pending_at: string | null
          has_unread_email: boolean
          id: string
          is_blocking_number: boolean
          last_inbound_email_at: string | null
          name: string
          notes: string | null
          parent_system_id: string | null
          pending_voice_send_at: string | null
          phone: string | null
          reminder_agent_ids: string[] | null
          reminder_at: string | null
          reminder_handled: boolean
          secondary_status: string | null
          snoozed_until: string | null
          source: string | null
          status: Database["public"]["Enums"]["system_status"]
          system_code: string
          updated_at: string
          voice_message_sent_at: string | null
        }
        Insert: {
          additional_caller_phones?: Json
          additional_emails?: Json
          assigned_agent_id?: string | null
          audio_url?: string | null
          caller_phone?: string | null
          created_at?: string
          email?: string | null
          handled_pending_at?: string | null
          has_unread_email?: boolean
          id?: string
          is_blocking_number?: boolean
          last_inbound_email_at?: string | null
          name: string
          notes?: string | null
          parent_system_id?: string | null
          pending_voice_send_at?: string | null
          phone?: string | null
          reminder_agent_ids?: string[] | null
          reminder_at?: string | null
          reminder_handled?: boolean
          secondary_status?: string | null
          snoozed_until?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["system_status"]
          system_code: string
          updated_at?: string
          voice_message_sent_at?: string | null
        }
        Update: {
          additional_caller_phones?: Json
          additional_emails?: Json
          assigned_agent_id?: string | null
          audio_url?: string | null
          caller_phone?: string | null
          created_at?: string
          email?: string | null
          handled_pending_at?: string | null
          has_unread_email?: boolean
          id?: string
          is_blocking_number?: boolean
          last_inbound_email_at?: string | null
          name?: string
          notes?: string | null
          parent_system_id?: string | null
          pending_voice_send_at?: string | null
          phone?: string | null
          reminder_agent_ids?: string[] | null
          reminder_at?: string | null
          reminder_handled?: boolean
          secondary_status?: string | null
          snoozed_until?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["system_status"]
          system_code?: string
          updated_at?: string
          voice_message_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "systems_parent_system_id_fkey"
            columns: ["parent_system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          allowed: boolean
          crm_key: string
          permission: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          allowed?: boolean
          crm_key?: string
          permission: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          allowed?: boolean
          crm_key?: string
          permission?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_message_log: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          phone: string | null
          phone_index: number
          send_mode: string
          status_key: string | null
          success: boolean
          system_code: string | null
          system_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          phone?: string | null
          phone_index?: number
          send_mode?: string
          status_key?: string | null
          success: boolean
          system_code?: string | null
          system_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          phone?: string | null
          phone_index?: number
          send_mode?: string
          status_key?: string | null
          success?: boolean
          system_code?: string | null
          system_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_message_log_system_id_fkey"
            columns: ["system_id"]
            isOneToOne: false
            referencedRelation: "systems"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_rate_limit: {
        Args: { _key: string; _window_seconds: number }
        Returns: number
      }
      has_crm_access: {
        Args: { _crm_key: string; _user_id: string }
        Returns: boolean
      }
      list_systems_page: {
        Args: {
          _agent?: string
          _from?: string
          _limit?: number
          _offset?: number
          _q?: string
          _secondary_values?: string[]
          _status_values?: string[]
          _to?: string
        }
        Returns: Json
      }
      purge_old_activity_logs: { Args: { _days?: number }; Returns: Json }
      set_change_reason: { Args: { p_reason: string }; Returns: undefined }
      systems_status_counts: {
        Args: { _agent?: string; _from?: string; _to?: string }
        Returns: {
          cnt: number
          secondary_status: string
          status: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "agent" | "super_admin" | "viewer"
      system_status:
        | "open"
        | "closed"
        | "pending_check_close"
        | "pending_check_open"
        | "problem"
        | "open_only_bimot"
        | "close_only_bimot"
        | "open_in_simahedrin"
        | "close_in_simahedrin"
        | "send_to_yosela"
        | "block_from_root"
        | "to_block"
        | "to_open"
        | "sent_to_yosela"
        | "blocked_from_root"
        | "send_to_committee"
        | "sent_to_committee"
        | "blocked_in_committee"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "agent", "super_admin", "viewer"],
      system_status: [
        "open",
        "closed",
        "pending_check_close",
        "pending_check_open",
        "problem",
        "open_only_bimot",
        "close_only_bimot",
        "open_in_simahedrin",
        "close_in_simahedrin",
        "send_to_yosela",
        "block_from_root",
        "to_block",
        "to_open",
        "sent_to_yosela",
        "blocked_from_root",
        "send_to_committee",
        "sent_to_committee",
        "blocked_in_committee",
      ],
    },
  },
} as const
