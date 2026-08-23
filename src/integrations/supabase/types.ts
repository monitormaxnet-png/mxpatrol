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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_insights: {
        Row: {
          company_id: string
          created_at: string
          data: Json
          id: string
          severity: Database["public"]["Enums"]["incident_severity"] | null
          summary: string | null
          type: string
        }
        Insert: {
          company_id: string
          created_at?: string
          data?: Json
          id?: string
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          summary?: string | null
          type: string
        }
        Update: {
          company_id?: string
          created_at?: string
          data?: Json
          id?: string
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          summary?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reports: {
        Row: {
          company_id: string
          created_at: string
          data: Json | null
          generated_at: string
          id: string
          report_type: string
          summary_text: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          data?: Json | null
          generated_at?: string
          id?: string
          report_type?: string
          summary_text?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          data?: Json | null
          generated_at?: string
          id?: string
          report_type?: string
          summary_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          checkpoint_id: string | null
          company_id: string
          created_at: string
          device_identifier: string | null
          event_occurred_at: string | null
          gps_accuracy: number | null
          guard_id: string | null
          id: string
          is_read: boolean | null
          location_lat: number | null
          location_lng: number | null
          message: string
          patrol_id: string | null
          session_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"] | null
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          checkpoint_id?: string | null
          company_id: string
          created_at?: string
          device_identifier?: string | null
          event_occurred_at?: string | null
          gps_accuracy?: number | null
          guard_id?: string | null
          id?: string
          is_read?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          message: string
          patrol_id?: string | null
          session_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          checkpoint_id?: string | null
          company_id?: string
          created_at?: string
          device_identifier?: string | null
          event_occurred_at?: string | null
          gps_accuracy?: number | null
          guard_id?: string | null
          id?: string
          is_read?: boolean | null
          location_lat?: number | null
          location_lng?: number | null
          message?: string
          patrol_id?: string | null
          session_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_reports"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "alerts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      camera_events: {
        Row: {
          camera_id: string
          clip_url: string | null
          company_id: string
          created_at: string
          description: string | null
          detected_at: string
          event_type: string
          id: string
          metadata: Json | null
          severity: string
          thumbnail_url: string | null
        }
        Insert: {
          camera_id: string
          clip_url?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          detected_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          severity?: string
          thumbnail_url?: string | null
        }
        Update: {
          camera_id?: string
          clip_url?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          detected_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          severity?: string
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "camera_events_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "camera_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cameras: {
        Row: {
          camera_type: string
          checkpoint_id: string | null
          company_id: string
          created_at: string
          id: string
          ip_address: string | null
          is_recording: boolean
          location: string | null
          location_lat: number | null
          location_lng: number | null
          name: string
          settings: Json | null
          status: string
          stream_url: string
          updated_at: string
        }
        Insert: {
          camera_type?: string
          checkpoint_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          is_recording?: boolean
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          name: string
          settings?: Json | null
          status?: string
          stream_url: string
          updated_at?: string
        }
        Update: {
          camera_type?: string
          checkpoint_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          is_recording?: boolean
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          name?: string
          settings?: Json | null
          status?: string
          stream_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cameras_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cameras_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      checkpoints: {
        Row: {
          company_id: string
          created_at: string
          data_log_form_id: string | null
          id: string
          location_lat: number | null
          location_lng: number | null
          location_note: string | null
          name: string
          nfc_tag_id: string
          patrol_id: string | null
          site_id: string | null
          sort_order: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          data_log_form_id?: string | null
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          location_note?: string | null
          name: string
          nfc_tag_id: string
          patrol_id?: string | null
          site_id?: string | null
          sort_order?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          data_log_form_id?: string | null
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          location_note?: string | null
          name?: string
          nfc_tag_id?: string
          patrol_id?: string | null
          site_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checkpoints_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoints_data_log_form_id_fkey"
            columns: ["data_log_form_id"]
            isOneToOne: false
            referencedRelation: "data_log_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoints_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkpoints_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          settings: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          settings?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          settings?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      compliance_scores: {
        Row: {
          company_id: string
          created_at: string
          details: Json | null
          device_id: string
          heartbeat_score: number | null
          id: string
          overall_score: number | null
          patrol_score: number | null
          policy_score: number | null
          scored_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          details?: Json | null
          device_id: string
          heartbeat_score?: number | null
          id?: string
          overall_score?: number | null
          patrol_score?: number | null
          policy_score?: number | null
          scored_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          details?: Json | null
          device_id?: string
          heartbeat_score?: number | null
          id?: string
          overall_score?: number | null
          patrol_score?: number | null
          policy_score?: number | null
          scored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_scores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_scores_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      data_log_form_fields: {
        Row: {
          company_id: string
          config_json: Json
          created_at: string
          field_type: string
          form_id: string
          id: string
          is_active: boolean
          label: string
          options_json: Json
          placeholder: string | null
          required: boolean
          sequence_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          config_json?: Json
          created_at?: string
          field_type: string
          form_id: string
          id?: string
          is_active?: boolean
          label: string
          options_json?: Json
          placeholder?: string | null
          required?: boolean
          sequence_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          config_json?: Json
          created_at?: string
          field_type?: string
          form_id?: string
          id?: string
          is_active?: boolean
          label?: string
          options_json?: Json
          placeholder?: string | null
          required?: boolean
          sequence_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_log_form_fields_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "data_log_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      data_log_forms: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          form_type: string
          id: string
          is_active: boolean
          name: string
          site_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          form_type: string
          id?: string
          is_active?: boolean
          name: string
          site_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          form_type?: string
          id?: string
          is_active?: boolean
          name?: string
          site_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_log_forms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_forms_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      data_log_submissions: {
        Row: {
          checkpoint_id: string
          company_id: string
          created_at: string
          device_id: string | null
          form_id: string
          id: string
          patrol_session_checkpoint_id: string | null
          patrol_session_id: string | null
          responses_json: Json
          scan_log_id: string | null
          site_id: string | null
          status: string
          submitted_at: string
          submitted_by: string | null
          validation_errors: Json
        }
        Insert: {
          checkpoint_id: string
          company_id: string
          created_at?: string
          device_id?: string | null
          form_id: string
          id?: string
          patrol_session_checkpoint_id?: string | null
          patrol_session_id?: string | null
          responses_json?: Json
          scan_log_id?: string | null
          site_id?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          validation_errors?: Json
        }
        Update: {
          checkpoint_id?: string
          company_id?: string
          created_at?: string
          device_id?: string | null
          form_id?: string
          id?: string
          patrol_session_checkpoint_id?: string | null
          patrol_session_id?: string | null
          responses_json?: Json
          scan_log_id?: string | null
          site_id?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "data_log_submissions_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "data_log_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_patrol_session_checkpoint_id_fkey"
            columns: ["patrol_session_checkpoint_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_patrol_session_id_fkey"
            columns: ["patrol_session_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_reports"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "data_log_submissions_patrol_session_id_fkey"
            columns: ["patrol_session_id"]
            isOneToOne: false
            referencedRelation: "patrol_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_scan_log_id_fkey"
            columns: ["scan_log_id"]
            isOneToOne: true
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_log_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_activity_logs: {
        Row: {
          action: Database["public"]["Enums"]["device_action"]
          company_id: string
          created_at: string
          device_id: string
          id: string
          metadata: Json | null
          performed_by: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["device_action"]
          company_id: string
          created_at?: string
          device_id: string
          id?: string
          metadata?: Json | null
          performed_by?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["device_action"]
          company_id?: string
          created_at?: string
          device_id?: string
          id?: string
          metadata?: Json | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_activity_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_activity_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_commands: {
        Row: {
          command_type: Database["public"]["Enums"]["command_type"]
          company_id: string
          created_at: string
          device_id: string
          executed_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          payload: Json | null
          result: Json | null
          retry_count: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["command_status"]
        }
        Insert: {
          command_type: Database["public"]["Enums"]["command_type"]
          company_id: string
          created_at?: string
          device_id: string
          executed_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          payload?: Json | null
          result?: Json | null
          retry_count?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["command_status"]
        }
        Update: {
          command_type?: Database["public"]["Enums"]["command_type"]
          company_id?: string
          created_at?: string
          device_id?: string
          executed_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          payload?: Json | null
          result?: Json | null
          retry_count?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["command_status"]
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          app_version: string | null
          battery_level: number | null
          company_id: string
          created_at: string
          device_id: string
          id: string
          ip_address: string | null
          is_online: boolean | null
          metadata: Json | null
        }
        Insert: {
          app_version?: string | null
          battery_level?: number | null
          company_id: string
          created_at?: string
          device_id: string
          id?: string
          ip_address?: string | null
          is_online?: boolean | null
          metadata?: Json | null
        }
        Update: {
          app_version?: string | null
          battery_level?: number | null
          company_id?: string
          created_at?: string
          device_id?: string
          id?: string
          ip_address?: string | null
          is_online?: boolean | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_request_nonces: {
        Row: {
          action: string
          created_at: string
          device_id: string
          id: string
          nonce: string
          payload_hash: string | null
          request_timestamp: string
        }
        Insert: {
          action: string
          created_at?: string
          device_id: string
          id?: string
          nonce: string
          payload_hash?: string | null
          request_timestamp: string
        }
        Update: {
          action?: string
          created_at?: string
          device_id?: string
          id?: string
          nonce?: string
          payload_hash?: string | null
          request_timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_request_nonces_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_security_events: {
        Row: {
          app_version: string | null
          company_id: string
          device_id: string | null
          device_identifier: string | null
          event_type: string
          id: string
          initiated_by: string | null
          metadata: Json
          occurred_at: string
          severity: string
          site_id: string | null
        }
        Insert: {
          app_version?: string | null
          company_id: string
          device_id?: string | null
          device_identifier?: string | null
          event_type: string
          id?: string
          initiated_by?: string | null
          metadata?: Json
          occurred_at?: string
          severity?: string
          site_id?: string | null
        }
        Update: {
          app_version?: string | null
          company_id?: string
          device_id?: string | null
          device_identifier?: string | null
          event_type?: string
          id?: string
          initiated_by?: string | null
          metadata?: Json
          occurred_at?: string
          severity?: string
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_security_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_security_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_security_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          adb_detected: boolean
          app_build_number: string | null
          app_package_name: string | null
          app_signature_sha256: string | null
          app_type: Database["public"]["Enums"]["app_type"] | null
          app_version: string | null
          auth_token_hash: string | null
          battery_level: number | null
          company_id: string
          compliance_score: number | null
          created_at: string
          current_gps_accuracy: number | null
          current_gps_at: string | null
          current_gps_lat: number | null
          current_gps_lng: number | null
          developer_mode_detected: boolean
          device_identifier: string
          device_key_registered_at: string | null
          device_name: string | null
          device_owner_active: boolean
          device_type: string
          disabled_at: string | null
          enrolled_via: string | null
          guard_id: string | null
          id: string
          installation_id: string | null
          is_debug_build: boolean
          kiosk_active: boolean
          last_integrity_check_at: string | null
          last_secure_auth_at: string | null
          last_seen_at: string | null
          maintenance_expires_at: string | null
          metadata: Json
          minimum_app_version: string | null
          notes: string | null
          pairing_code: string | null
          pairing_expires_at: string | null
          pairing_status: string
          public_key: string | null
          public_key_algorithm: string | null
          registration_date: string
          revoked_at: string | null
          revoked_by: string | null
          root_risk_detected: boolean
          secure_mode_enabled: boolean
          secure_mode_status: string
          secure_offline_trust_expires_at: string | null
          serial_number: string | null
          site_id: string | null
          site_location: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          adb_detected?: boolean
          app_build_number?: string | null
          app_package_name?: string | null
          app_signature_sha256?: string | null
          app_type?: Database["public"]["Enums"]["app_type"] | null
          app_version?: string | null
          auth_token_hash?: string | null
          battery_level?: number | null
          company_id: string
          compliance_score?: number | null
          created_at?: string
          current_gps_accuracy?: number | null
          current_gps_at?: string | null
          current_gps_lat?: number | null
          current_gps_lng?: number | null
          developer_mode_detected?: boolean
          device_identifier: string
          device_key_registered_at?: string | null
          device_name?: string | null
          device_owner_active?: boolean
          device_type?: string
          disabled_at?: string | null
          enrolled_via?: string | null
          guard_id?: string | null
          id?: string
          installation_id?: string | null
          is_debug_build?: boolean
          kiosk_active?: boolean
          last_integrity_check_at?: string | null
          last_secure_auth_at?: string | null
          last_seen_at?: string | null
          maintenance_expires_at?: string | null
          metadata?: Json
          minimum_app_version?: string | null
          notes?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          pairing_status?: string
          public_key?: string | null
          public_key_algorithm?: string | null
          registration_date?: string
          revoked_at?: string | null
          revoked_by?: string | null
          root_risk_detected?: boolean
          secure_mode_enabled?: boolean
          secure_mode_status?: string
          secure_offline_trust_expires_at?: string | null
          serial_number?: string | null
          site_id?: string | null
          site_location?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          adb_detected?: boolean
          app_build_number?: string | null
          app_package_name?: string | null
          app_signature_sha256?: string | null
          app_type?: Database["public"]["Enums"]["app_type"] | null
          app_version?: string | null
          auth_token_hash?: string | null
          battery_level?: number | null
          company_id?: string
          compliance_score?: number | null
          created_at?: string
          current_gps_accuracy?: number | null
          current_gps_at?: string | null
          current_gps_lat?: number | null
          current_gps_lng?: number | null
          developer_mode_detected?: boolean
          device_identifier?: string
          device_key_registered_at?: string | null
          device_name?: string | null
          device_owner_active?: boolean
          device_type?: string
          disabled_at?: string | null
          enrolled_via?: string | null
          guard_id?: string | null
          id?: string
          installation_id?: string | null
          is_debug_build?: boolean
          kiosk_active?: boolean
          last_integrity_check_at?: string | null
          last_secure_auth_at?: string | null
          last_seen_at?: string | null
          maintenance_expires_at?: string | null
          metadata?: Json
          minimum_app_version?: string | null
          notes?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          pairing_status?: string
          public_key?: string | null
          public_key_algorithm?: string | null
          registration_date?: string
          revoked_at?: string | null
          revoked_by?: string | null
          root_risk_detected?: boolean
          secure_mode_enabled?: boolean
          secure_mode_status?: string
          secure_offline_trust_expires_at?: string | null
          serial_number?: string | null
          site_id?: string | null
          site_location?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_tokens: {
        Row: {
          app_type: Database["public"]["Enums"]["app_type"]
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          nonce: string
          token: string
          used: boolean
          used_by_device_id: string | null
        }
        Insert: {
          app_type?: Database["public"]["Enums"]["app_type"]
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          nonce: string
          token: string
          used?: boolean
          used_by_device_id?: string | null
        }
        Update: {
          app_type?: Database["public"]["Enums"]["app_type"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          nonce?: string
          token?: string
          used?: boolean
          used_by_device_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_tokens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tokens_used_by_device_id_fkey"
            columns: ["used_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      guard_scores: {
        Row: {
          company_id: string
          completion_score: number | null
          created_at: string
          guard_id: string
          id: string
          incident_score: number | null
          overall_score: number | null
          period_end: string
          period_start: string
          punctuality_score: number | null
        }
        Insert: {
          company_id: string
          completion_score?: number | null
          created_at?: string
          guard_id: string
          id?: string
          incident_score?: number | null
          overall_score?: number | null
          period_end: string
          period_start: string
          punctuality_score?: number | null
        }
        Update: {
          company_id?: string
          completion_score?: number | null
          created_at?: string
          guard_id?: string
          id?: string
          incident_score?: number | null
          overall_score?: number | null
          period_end?: string
          period_start?: string
          punctuality_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "guard_scores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guard_scores_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
        ]
      }
      guards: {
        Row: {
          badge_number: string
          company_id: string
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          performance_score: number | null
          phone: string | null
          photo_url: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          badge_number: string
          company_id: string
          created_at?: string
          full_name: string
          id?: string
          is_active?: boolean
          performance_score?: number | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          badge_number?: string
          company_id?: string
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          performance_score?: number | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_report_photos: {
        Row: {
          captured_at: string
          company_id: string
          created_at: string
          device_identifier: string
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          site_id: string | null
          storage_path: string
        }
        Insert: {
          captured_at: string
          company_id: string
          created_at?: string
          device_identifier: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          site_id?: string | null
          storage_path: string
        }
        Update: {
          captured_at?: string
          company_id?: string
          created_at?: string
          device_identifier?: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          site_id?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_report_photos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_report_photos_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          ai_classification: string | null
          ai_suggested_action: string | null
          checkpoint_id: string | null
          company_id: string
          created_at: string
          description: string | null
          device_identifier: string | null
          event_occurred_at: string | null
          guard_id: string | null
          id: string
          image_url: string | null
          location_lat: number | null
          location_lng: number | null
          resolved: boolean | null
          resolved_at: string | null
          session_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          site_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_classification?: string | null
          ai_suggested_action?: string | null
          checkpoint_id?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          device_identifier?: string | null
          event_occurred_at?: string | null
          guard_id?: string | null
          id?: string
          image_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          resolved?: boolean | null
          resolved_at?: string | null
          session_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          site_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_classification?: string | null
          ai_suggested_action?: string | null
          checkpoint_id?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          device_identifier?: string | null
          event_occurred_at?: string | null
          guard_id?: string | null
          id?: string
          image_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          resolved?: boolean | null
          resolved_at?: string | null
          session_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          site_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_reports"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "incidents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      nfc_tag_audit_logs: {
        Row: {
          action: string
          actor_guard_id: string | null
          actor_user_id: string | null
          checkpoint_id: string | null
          company_id: string
          created_at: string
          device_id: string | null
          device_identifier: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          metadata: Json
          nfc_tag_id: string | null
          notes: string | null
          pending_tag_id: string | null
          performed_by: string | null
          scan_log_id: string | null
          tag_uid: string | null
        }
        Insert: {
          action: string
          actor_guard_id?: string | null
          actor_user_id?: string | null
          checkpoint_id?: string | null
          company_id: string
          created_at?: string
          device_id?: string | null
          device_identifier?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          metadata?: Json
          nfc_tag_id?: string | null
          notes?: string | null
          pending_tag_id?: string | null
          performed_by?: string | null
          scan_log_id?: string | null
          tag_uid?: string | null
        }
        Update: {
          action?: string
          actor_guard_id?: string | null
          actor_user_id?: string | null
          checkpoint_id?: string | null
          company_id?: string
          created_at?: string
          device_id?: string | null
          device_identifier?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          metadata?: Json
          nfc_tag_id?: string | null
          notes?: string | null
          pending_tag_id?: string | null
          performed_by?: string | null
          scan_log_id?: string | null
          tag_uid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfc_tag_audit_logs_scan_log_id_fkey"
            columns: ["scan_log_id"]
            isOneToOne: false
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_route_checkpoints: {
        Row: {
          checkpoint_id: string
          company_id: string
          created_at: string
          expected_arrival_offset_minutes: number | null
          expected_offset_minutes: number | null
          id: string
          is_required: boolean
          route_id: string
          sequence_order: number
        }
        Insert: {
          checkpoint_id: string
          company_id: string
          created_at?: string
          expected_arrival_offset_minutes?: number | null
          expected_offset_minutes?: number | null
          id?: string
          is_required?: boolean
          route_id: string
          sequence_order: number
        }
        Update: {
          checkpoint_id?: string
          company_id?: string
          created_at?: string
          expected_arrival_offset_minutes?: number | null
          expected_offset_minutes?: number | null
          id?: string
          is_required?: boolean
          route_id?: string
          sequence_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "patrol_route_checkpoints_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_route_checkpoints_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_route_checkpoints_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_routes: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          enforce_sequence: boolean
          id: string
          name: string
          site_id: string | null
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          enforce_sequence?: boolean
          id?: string
          name: string
          site_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          enforce_sequence?: boolean
          id?: string
          name?: string
          site_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_routes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_routes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_routes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_routes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "patrol_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_schedules: {
        Row: {
          active_from: string | null
          active_until: string | null
          company_id: string
          created_at: string
          created_by: string | null
          days_of_week: number[]
          description: string | null
          device_identifier: string | null
          end_time: string | null
          expected_duration_minutes: number | null
          frequency: string
          frequency_type: string
          grace_completion_minutes: number
          grace_start_minutes: number
          id: string
          interval_value: number
          name: string
          next_run_at: string | null
          route_id: string
          schedule_code: string | null
          site_id: string | null
          start_time: string | null
          status: string
          template_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          description?: string | null
          device_identifier?: string | null
          end_time?: string | null
          expected_duration_minutes?: number | null
          frequency?: string
          frequency_type?: string
          grace_completion_minutes?: number
          grace_start_minutes?: number
          id?: string
          interval_value?: number
          name: string
          next_run_at?: string | null
          route_id: string
          schedule_code?: string | null
          site_id?: string | null
          start_time?: string | null
          status?: string
          template_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          description?: string | null
          device_identifier?: string | null
          end_time?: string | null
          expected_duration_minutes?: number | null
          frequency?: string
          frequency_type?: string
          grace_completion_minutes?: number
          grace_start_minutes?: number
          id?: string
          interval_value?: number
          name?: string
          next_run_at?: string | null
          route_id?: string
          schedule_code?: string | null
          site_id?: string | null
          start_time?: string | null
          status?: string
          template_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_schedules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_schedules_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_schedules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "patrol_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_session_checkpoints: {
        Row: {
          audit_meta: Json
          checkpoint_id: string
          checkpoint_name_snapshot: string | null
          company_id: string
          created_at: string
          data_log_form_id: string | null
          data_log_required: boolean
          data_log_status: string
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          required: boolean
          route_checkpoint_id: string | null
          scan_log_id: string | null
          scanned_at: string | null
          scheduled_at: string | null
          scheduled_order: number
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          audit_meta?: Json
          checkpoint_id: string
          checkpoint_name_snapshot?: string | null
          company_id: string
          created_at?: string
          data_log_form_id?: string | null
          data_log_required?: boolean
          data_log_status?: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          required?: boolean
          route_checkpoint_id?: string | null
          scan_log_id?: string | null
          scanned_at?: string | null
          scheduled_at?: string | null
          scheduled_order: number
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          audit_meta?: Json
          checkpoint_id?: string
          checkpoint_name_snapshot?: string | null
          company_id?: string
          created_at?: string
          data_log_form_id?: string | null
          data_log_required?: boolean
          data_log_status?: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          required?: boolean
          route_checkpoint_id?: string | null
          scan_log_id?: string | null
          scanned_at?: string | null
          scheduled_at?: string | null
          scheduled_order?: number
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_session_checkpoints_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_data_log_form_id_fkey"
            columns: ["data_log_form_id"]
            isOneToOne: false
            referencedRelation: "data_log_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_route_checkpoint_id_fkey"
            columns: ["route_checkpoint_id"]
            isOneToOne: false
            referencedRelation: "patrol_route_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_scan_log_id_fkey"
            columns: ["scan_log_id"]
            isOneToOne: false
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_reports"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "patrol_session_checkpoints_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "patrol_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_sessions: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          checkpoint_completed: number
          checkpoint_total: number
          company_id: string
          completed_required_count: number
          created_at: string
          critical_incident_count: number
          device_id: string | null
          device_identifier: string | null
          finalized_at: string | null
          first_scan_at: string | null
          guard_id: string | null
          id: string
          incident_count: number
          last_scan_at: string | null
          latest_sos_at: string | null
          meta: Json
          missed_reason: string | null
          open_incident_count: number
          progress: number
          progress_percent: number
          route_id: string
          schedule_id: string | null
          scheduled_end: string | null
          scheduled_start: string
          site_id: string | null
          sos_count: number
          status: string
          template_id: string | null
          total_required_count: number
          unacknowledged_sos_count: number
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          checkpoint_completed?: number
          checkpoint_total?: number
          company_id: string
          completed_required_count?: number
          created_at?: string
          critical_incident_count?: number
          device_id?: string | null
          device_identifier?: string | null
          finalized_at?: string | null
          first_scan_at?: string | null
          guard_id?: string | null
          id?: string
          incident_count?: number
          last_scan_at?: string | null
          latest_sos_at?: string | null
          meta?: Json
          missed_reason?: string | null
          open_incident_count?: number
          progress?: number
          progress_percent?: number
          route_id: string
          schedule_id?: string | null
          scheduled_end?: string | null
          scheduled_start: string
          site_id?: string | null
          sos_count?: number
          status?: string
          template_id?: string | null
          total_required_count?: number
          unacknowledged_sos_count?: number
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          checkpoint_completed?: number
          checkpoint_total?: number
          company_id?: string
          completed_required_count?: number
          created_at?: string
          critical_incident_count?: number
          device_id?: string | null
          device_identifier?: string | null
          finalized_at?: string | null
          first_scan_at?: string | null
          guard_id?: string | null
          id?: string
          incident_count?: number
          last_scan_at?: string | null
          latest_sos_at?: string | null
          meta?: Json
          missed_reason?: string | null
          open_incident_count?: number
          progress?: number
          progress_percent?: number
          route_id?: string
          schedule_id?: string | null
          scheduled_end?: string | null
          scheduled_start?: string
          site_id?: string | null
          sos_count?: number
          status?: string
          template_id?: string | null
          total_required_count?: number
          unacknowledged_sos_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "patrol_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "patrol_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      patrol_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          expected_duration_minutes: number
          id: string
          name: string
          site_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_duration_minutes?: number
          id?: string
          name: string
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_duration_minutes?: number
          id?: string
          name?: string
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrol_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_templates_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      patrols: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          device_identifier: string | null
          expected_duration_minutes: number | null
          guard_id: string | null
          id: string
          name: string
          schedule: Json | null
          site_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["patrol_status"]
          updated_at: string
          verification_level: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          device_identifier?: string | null
          expected_duration_minutes?: number | null
          guard_id?: string | null
          id?: string
          name: string
          schedule?: Json | null
          site_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["patrol_status"]
          updated_at?: string
          verification_level?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          device_identifier?: string | null
          expected_duration_minutes?: number | null
          guard_id?: string | null
          id?: string
          name?: string
          schedule?: Json | null
          site_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["patrol_status"]
          updated_at?: string
          verification_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrols_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_nfc_tags: {
        Row: {
          alert_id: string | null
          checkpoint_id: string | null
          company_id: string
          created_at: string
          device_id: string | null
          device_identifier: string | null
          device_metadata: Json
          first_seen_at: string
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          last_seen_at: string
          metadata: Json
          nfc_tag_id: string
          proposed_name: string | null
          rejection_reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan_log_id: string | null
          site_id: string | null
          status: string
          submitted_by_guard_id: string | null
          submitted_by_user_id: string | null
          tag_uid: string
          updated_at: string
        }
        Insert: {
          alert_id?: string | null
          checkpoint_id?: string | null
          company_id: string
          created_at?: string
          device_id?: string | null
          device_identifier?: string | null
          device_metadata?: Json
          first_seen_at?: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          last_seen_at?: string
          metadata?: Json
          nfc_tag_id: string
          proposed_name?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_log_id?: string | null
          site_id?: string | null
          status?: string
          submitted_by_guard_id?: string | null
          submitted_by_user_id?: string | null
          tag_uid: string
          updated_at?: string
        }
        Update: {
          alert_id?: string | null
          checkpoint_id?: string | null
          company_id?: string
          created_at?: string
          device_id?: string | null
          device_identifier?: string | null
          device_metadata?: Json
          first_seen_at?: string
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          last_seen_at?: string
          metadata?: Json
          nfc_tag_id?: string
          proposed_name?: string | null
          rejection_reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_log_id?: string | null
          site_id?: string | null
          status?: string
          submitted_by_guard_id?: string | null
          submitted_by_user_id?: string | null
          tag_uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_nfc_tags_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_nfc_tags_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_nfc_tags_scan_log_id_fkey"
            columns: ["scan_log_id"]
            isOneToOne: false
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          full_name: string | null
          id: string
          onboarding_completed: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          onboarding_completed?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      report_jobs: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          date_range: string
          error_message: string | null
          failed_at: string | null
          filters: Json
          id: string
          metadata: Json
          report_id: string | null
          report_type: string
          scheduled_for: string | null
          site_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          date_range?: string
          error_message?: string | null
          failed_at?: string | null
          filters?: Json
          id?: string
          metadata?: Json
          report_id?: string | null
          report_type?: string
          scheduled_for?: string | null
          site_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          date_range?: string
          error_message?: string | null
          failed_at?: string | null
          filters?: Json
          id?: string
          metadata?: Json
          report_id?: string | null
          report_type?: string
          scheduled_for?: string | null
          site_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_jobs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_jobs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_logs: {
        Row: {
          checkpoint_id: string | null
          client_scan_id: string | null
          company_id: string
          created_at: string
          data_log_required: boolean
          data_log_status: string
          device_id: string | null
          device_identifier: string | null
          device_metadata: Json | null
          face_confidence: number | null
          face_verified: boolean | null
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          guard_id: string | null
          id: string
          is_manual: boolean
          is_offline_sync: boolean | null
          manual_scan_reason: string | null
          patrol_match_status: string
          patrol_route_id: string | null
          patrol_schedule_id: string | null
          patrol_session_id: string | null
          patrol_template_id: string | null
          patrol_validation_status: string | null
          scanned_at: string
          scanned_by: string | null
          site_id: string | null
          tag_status: string
          tag_uid: string | null
          user_id: string | null
        }
        Insert: {
          checkpoint_id?: string | null
          client_scan_id?: string | null
          company_id: string
          created_at?: string
          data_log_required?: boolean
          data_log_status?: string
          device_id?: string | null
          device_identifier?: string | null
          device_metadata?: Json | null
          face_confidence?: number | null
          face_verified?: boolean | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          guard_id?: string | null
          id?: string
          is_manual?: boolean
          is_offline_sync?: boolean | null
          manual_scan_reason?: string | null
          patrol_match_status?: string
          patrol_route_id?: string | null
          patrol_schedule_id?: string | null
          patrol_session_id?: string | null
          patrol_template_id?: string | null
          patrol_validation_status?: string | null
          scanned_at?: string
          scanned_by?: string | null
          site_id?: string | null
          tag_status?: string
          tag_uid?: string | null
          user_id?: string | null
        }
        Update: {
          checkpoint_id?: string | null
          client_scan_id?: string | null
          company_id?: string
          created_at?: string
          data_log_required?: boolean
          data_log_status?: string
          device_id?: string | null
          device_identifier?: string | null
          device_metadata?: Json | null
          face_confidence?: number | null
          face_verified?: boolean | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          guard_id?: string | null
          id?: string
          is_manual?: boolean
          is_offline_sync?: boolean | null
          manual_scan_reason?: string | null
          patrol_match_status?: string
          patrol_route_id?: string | null
          patrol_schedule_id?: string | null
          patrol_session_id?: string | null
          patrol_template_id?: string | null
          patrol_validation_status?: string | null
          scanned_at?: string
          scanned_by?: string | null
          site_id?: string | null
          tag_status?: string
          tag_uid?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_logs_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_patrol_route_id_fkey"
            columns: ["patrol_route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_patrol_schedule_id_fkey"
            columns: ["patrol_schedule_id"]
            isOneToOne: false
            referencedRelation: "patrol_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_patrol_session_id_fkey"
            columns: ["patrol_session_id"]
            isOneToOne: false
            referencedRelation: "patrol_session_reports"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "scan_logs_patrol_session_id_fkey"
            columns: ["patrol_session_id"]
            isOneToOne: false
            referencedRelation: "patrol_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_patrol_template_id_fkey"
            columns: ["patrol_template_id"]
            isOneToOne: false
            referencedRelation: "patrol_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_logs_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          company_id: string
          created_at: string
          day_of_week: number
          device_identifier: string | null
          end_time: string
          guard_id: string
          id: string
          is_recurring: boolean
          notes: string | null
          site_id: string | null
          specific_date: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          day_of_week: number
          device_identifier?: string | null
          end_time: string
          guard_id: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          site_id?: string | null
          specific_date?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          day_of_week?: number
          device_identifier?: string | null
          end_time?: string
          guard_id?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          site_id?: string | null
          specific_date?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          name: string
          status: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          name: string
          status?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_authorized_numbers: {
        Row: {
          allowed_site_ids: string[]
          authorized_by: string | null
          company_id: string | null
          created_at: string
          display_name: string | null
          guard_id: string | null
          id: string
          last_seen_at: string | null
          link_code: string | null
          link_code_expires_at: string | null
          linked_at: string | null
          metadata: Json
          phone: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          allowed_site_ids?: string[]
          authorized_by?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          guard_id?: string | null
          id?: string
          last_seen_at?: string | null
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          metadata?: Json
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          allowed_site_ids?: string[]
          authorized_by?: string | null
          company_id?: string | null
          created_at?: string
          display_name?: string | null
          guard_id?: string | null
          id?: string
          last_seen_at?: string | null
          link_code?: string | null
          link_code_expires_at?: string | null
          linked_at?: string | null
          metadata?: Json
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_authorized_numbers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_authorized_numbers_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          company_id: string
          created_at: string
          guard_id: string | null
          id: string
          is_active: boolean
          phone_number: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          guard_id?: string | null
          id?: string
          is_active?: boolean
          phone_number: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          guard_id?: string | null
          id?: string
          is_active?: boolean
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_guard_id_fkey"
            columns: ["guard_id"]
            isOneToOne: false
            referencedRelation: "guards"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          direction: string
          id: string
          message_body: string
          message_type: string
          metadata: Json | null
          twilio_sid: string | null
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          direction?: string
          id?: string
          message_body: string
          message_type?: string
          metadata?: Json | null
          twilio_sid?: string | null
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          message_body?: string
          message_type?: string
          metadata?: Json | null
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_nfc_capture_requests: {
        Row: {
          captured_at: string | null
          checkpoint_name: string | null
          company_id: string
          created_at: string
          device_identifier: string | null
          expires_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          metadata: Json
          nfc_tag_id: string | null
          phone: string
          purpose: string
          requested_by: string | null
          session_id: string | null
          site_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          captured_at?: string | null
          checkpoint_name?: string | null
          company_id: string
          created_at?: string
          device_identifier?: string | null
          expires_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          metadata?: Json
          nfc_tag_id?: string | null
          phone: string
          purpose?: string
          requested_by?: string | null
          session_id?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          captured_at?: string | null
          checkpoint_name?: string | null
          company_id?: string
          created_at?: string
          device_identifier?: string | null
          expires_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          metadata?: Json
          nfc_tag_id?: string | null
          phone?: string
          purpose?: string
          requested_by?: string | null
          session_id?: string | null
          site_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_nfc_capture_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_nfc_capture_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_nfc_capture_requests_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          authorized_number_id: string | null
          company_id: string | null
          created_at: string
          current_flow: string | null
          current_site_id: string | null
          current_site_name: string | null
          current_step: string | null
          expires_at: string
          id: string
          last_inbound_at: string
          last_menu: string | null
          phone: string
          site_scope: string
          temporary_data: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          authorized_number_id?: string | null
          company_id?: string | null
          created_at?: string
          current_flow?: string | null
          current_site_id?: string | null
          current_site_name?: string | null
          current_step?: string | null
          expires_at?: string
          id?: string
          last_inbound_at?: string
          last_menu?: string | null
          phone: string
          site_scope?: string
          temporary_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          authorized_number_id?: string | null
          company_id?: string | null
          created_at?: string
          current_flow?: string | null
          current_site_id?: string | null
          current_site_name?: string | null
          current_step?: string | null
          expires_at?: string
          id?: string
          last_inbound_at?: string
          last_menu?: string | null
          phone?: string
          site_scope?: string
          temporary_data?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_authorized_number_id_fkey"
            columns: ["authorized_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_authorized_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_current_site_id_fkey"
            columns: ["current_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      patrol_session_reports: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          checkpoints: Json | null
          company_id: string | null
          completed_checkpoints: number | null
          critical_incident_count: number | null
          device_id: string | null
          device_identifier: string | null
          duration_seconds: number | null
          expected_checkpoints: number | null
          finalized_at: string | null
          incident_count: number | null
          incidents: Json | null
          latest_sos_at: string | null
          meta: Json | null
          missed_checkpoint_count: number | null
          missed_checkpoint_names: string[] | null
          open_incident_count: number | null
          progress_percent: number | null
          route_id: string | null
          route_name: string | null
          schedule_id: string | null
          schedule_name: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          session_id: string | null
          site_id: string | null
          site_name: string | null
          sos_alerts: Json | null
          sos_count: number | null
          status: string | null
          template_id: string | null
          template_name: string | null
          unacknowledged_sos_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "patrol_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "patrol_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "patrol_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrol_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "patrol_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      advance_due_patrol_session_statuses: { Args: never; Returns: number }
      finalize_patrol_session: {
        Args: { p_session_id: string }
        Returns: {
          actual_end: string | null
          actual_start: string | null
          checkpoint_completed: number
          checkpoint_total: number
          company_id: string
          completed_required_count: number
          created_at: string
          critical_incident_count: number
          device_id: string | null
          device_identifier: string | null
          finalized_at: string | null
          first_scan_at: string | null
          guard_id: string | null
          id: string
          incident_count: number
          last_scan_at: string | null
          latest_sos_at: string | null
          meta: Json
          missed_reason: string | null
          open_incident_count: number
          progress: number
          progress_percent: number
          route_id: string
          schedule_id: string | null
          scheduled_end: string | null
          scheduled_start: string
          site_id: string | null
          sos_count: number
          status: string
          template_id: string | null
          total_required_count: number
          unacknowledged_sos_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "patrol_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      find_eligible_patrol_session_for_event: {
        Args: {
          p_checkpoint_id?: string
          p_company_id: string
          p_device_identifier?: string
          p_occurred_at?: string
          p_site_id?: string
        }
        Returns: string
      }
      generate_due_patrol_sessions: {
        Args: { p_until?: string }
        Returns: number
      }
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_scan_to_patrol_session: {
        Args: { p_scan_log_id: string }
        Returns: {
          code: string
          completed: number
          match_status: string
          next_checkpoint_id: string
          next_checkpoint_name: string
          patrol_name: string
          progress_percent: number
          required: number
          schedule_id: string
          selection_reason: string
          session_checkpoint_id: string
          session_id: string
          session_status: string
        }[]
      }
      next_patrol_schedule_run: {
        Args: {
          p_current: string
          p_days: number[]
          p_frequency: string
          p_interval: number
        }
        Returns: string
      }
      recalculate_patrol_session_progress: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      refresh_patrol_session_event_counts: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      submit_data_log_submission: {
        Args: {
          p_responses_json: Json
          p_scan_log_id: string
          p_submitted_by?: string
        }
        Returns: {
          completed: number
          patrol_session_id: string
          progress_percent: number
          required: number
          session_checkpoint_id: string
          status: string
          submission_id: string
        }[]
      }
    }
    Enums: {
      alert_type:
        | "missed_checkpoint"
        | "late_patrol"
        | "panic_button"
        | "device_offline"
        | "anomaly"
      app_role: "admin" | "supervisor" | "guard"
      app_type: "admin_app" | "guard_device"
      command_status: "pending" | "sent" | "executed" | "failed"
      command_type:
        | "lock_device"
        | "wipe_device"
        | "set_kiosk_mode"
        | "update_policy"
        | "install_app"
        | "uninstall_app"
      device_action:
        | "enrolled"
        | "activated"
        | "suspended"
        | "revoked"
        | "replaced"
        | "heartbeat"
        | "command_sent"
        | "command_executed"
      device_status: "online" | "offline" | "low_battery"
      incident_severity: "low" | "medium" | "high" | "critical"
      patrol_status: "scheduled" | "in_progress" | "completed" | "missed"
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
      alert_type: [
        "missed_checkpoint",
        "late_patrol",
        "panic_button",
        "device_offline",
        "anomaly",
      ],
      app_role: ["admin", "supervisor", "guard"],
      app_type: ["admin_app", "guard_device"],
      command_status: ["pending", "sent", "executed", "failed"],
      command_type: [
        "lock_device",
        "wipe_device",
        "set_kiosk_mode",
        "update_policy",
        "install_app",
        "uninstall_app",
      ],
      device_action: [
        "enrolled",
        "activated",
        "suspended",
        "revoked",
        "replaced",
        "heartbeat",
        "command_sent",
        "command_executed",
      ],
      device_status: ["online", "offline", "low_battery"],
      incident_severity: ["low", "medium", "high", "critical"],
      patrol_status: ["scheduled", "in_progress", "completed", "missed"],
    },
  },
} as const
