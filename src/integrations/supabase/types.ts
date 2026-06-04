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
          company_id: string
          created_at: string
          guard_id: string | null
          id: string
          is_read: boolean | null
          message: string
          patrol_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"] | null
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          company_id: string
          created_at?: string
          guard_id?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          patrol_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          company_id?: string
          created_at?: string
          guard_id?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          patrol_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"] | null
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: [
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
          id: string
          location_lat: number | null
          location_lng: number | null
          name: string
          nfc_tag_id: string
          patrol_id: string | null
          sort_order: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          name: string
          nfc_tag_id: string
          patrol_id?: string | null
          sort_order?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          name?: string
          nfc_tag_id?: string
          patrol_id?: string | null
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
            foreignKeyName: "checkpoints_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
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
      devices: {
        Row: {
          app_type: Database["public"]["Enums"]["app_type"] | null
          battery_level: number | null
          company_id: string
          compliance_score: number | null
          created_at: string
          device_identifier: string
          device_name: string | null
          device_type: string
          enrolled_via: string | null
          guard_id: string | null
          id: string
          last_seen_at: string | null
          notes: string | null
          pairing_code: string | null
          pairing_expires_at: string | null
          pairing_status: string
          registration_date: string
          serial_number: string | null
          site_location: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
        }
        Insert: {
          app_type?: Database["public"]["Enums"]["app_type"] | null
          battery_level?: number | null
          company_id: string
          compliance_score?: number | null
          created_at?: string
          device_identifier: string
          device_name?: string | null
          device_type?: string
          enrolled_via?: string | null
          guard_id?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          pairing_status?: string
          registration_date?: string
          serial_number?: string | null
          site_location?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
        }
        Update: {
          app_type?: Database["public"]["Enums"]["app_type"] | null
          battery_level?: number | null
          company_id?: string
          compliance_score?: number | null
          created_at?: string
          device_identifier?: string
          device_name?: string | null
          device_type?: string
          enrolled_via?: string | null
          guard_id?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          pairing_code?: string | null
          pairing_expires_at?: string | null
          pairing_status?: string
          registration_date?: string
          serial_number?: string | null
          site_location?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
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
      incidents: {
        Row: {
          ai_classification: string | null
          ai_suggested_action: string | null
          company_id: string
          created_at: string
          description: string | null
          guard_id: string | null
          id: string
          image_url: string | null
          location_lat: number | null
          location_lng: number | null
          resolved: boolean | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          title: string
          updated_at: string
        }
        Insert: {
          ai_classification?: string | null
          ai_suggested_action?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          guard_id?: string | null
          id?: string
          image_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          title: string
          updated_at?: string
        }
        Update: {
          ai_classification?: string | null
          ai_suggested_action?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          guard_id?: string | null
          id?: string
          image_url?: string | null
          location_lat?: number | null
          location_lng?: number | null
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          title?: string
          updated_at?: string
        }
        Relationships: [
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
        ]
      }
      patrols: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          expected_duration_minutes: number | null
          guard_id: string | null
          id: string
          name: string
          schedule: Json | null
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
          expected_duration_minutes?: number | null
          guard_id?: string | null
          id?: string
          name: string
          schedule?: Json | null
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
          expected_duration_minutes?: number | null
          guard_id?: string | null
          id?: string
          name?: string
          schedule?: Json | null
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
        ]
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
      scan_logs: {
        Row: {
          checkpoint_id: string
          company_id: string
          created_at: string
          device_id: string | null
          face_confidence: number | null
          face_verified: boolean | null
          gps_lat: number | null
          gps_lng: number | null
          guard_id: string
          id: string
          is_manual: boolean
          is_offline_sync: boolean | null
          manual_scan_reason: string | null
          scanned_at: string
        }
        Insert: {
          checkpoint_id: string
          company_id: string
          created_at?: string
          device_id?: string | null
          face_confidence?: number | null
          face_verified?: boolean | null
          gps_lat?: number | null
          gps_lng?: number | null
          guard_id: string
          id?: string
          is_manual?: boolean
          is_offline_sync?: boolean | null
          manual_scan_reason?: string | null
          scanned_at?: string
        }
        Update: {
          checkpoint_id?: string
          company_id?: string
          created_at?: string
          device_id?: string | null
          face_confidence?: number | null
          face_verified?: boolean | null
          gps_lat?: number | null
          gps_lng?: number | null
          guard_id?: string
          id?: string
          is_manual?: boolean
          is_offline_sync?: boolean | null
          manual_scan_reason?: string | null
          scanned_at?: string
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
        ]
      }
      shifts: {
        Row: {
          company_id: string
          created_at: string
          day_of_week: number
          end_time: string
          guard_id: string
          id: string
          is_recurring: boolean
          notes: string | null
          specific_date: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          guard_id: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          specific_date?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          guard_id?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
