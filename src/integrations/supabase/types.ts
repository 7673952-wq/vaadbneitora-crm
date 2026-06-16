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
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      status_settings: {
        Row: {
          assigned_agent_ids: string[]
          is_custom: boolean
          is_handled: boolean
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
          assigned_agent_id: string | null
          audio_url: string | null
          caller_phone: string | null
          created_at: string
          email: string | null
          handled_pending_at: string | null
          id: string
          name: string
          notes: string | null
          parent_system_id: string | null
          phone: string | null
          reminder_agent_ids: string[] | null
          reminder_at: string | null
          reminder_handled: boolean
          snoozed_until: string | null
          source: string | null
          status: Database["public"]["Enums"]["system_status"]
          system_code: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          audio_url?: string | null
          caller_phone?: string | null
          created_at?: string
          email?: string | null
          handled_pending_at?: string | null
          id?: string
          name: string
          notes?: string | null
          parent_system_id?: string | null
          phone?: string | null
          reminder_agent_ids?: string[] | null
          reminder_at?: string | null
          reminder_handled?: boolean
          snoozed_until?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["system_status"]
          system_code: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          audio_url?: string | null
          caller_phone?: string | null
          created_at?: string
          email?: string | null
          handled_pending_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          parent_system_id?: string | null
          phone?: string | null
          reminder_agent_ids?: string[] | null
          reminder_at?: string | null
          reminder_handled?: boolean
          snoozed_until?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["system_status"]
          system_code?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_change_reason: { Args: { p_reason: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "agent" | "super_admin"
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
      app_role: ["admin", "agent", "super_admin"],
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
      ],
    },
  },
} as const
